"""The supplied Sophon model: pinned native ONNX weights, CPU, batch size one."""

import json
import logging
from pathlib import Path
import shutil

import numpy as np

from common import CONFIG_DIR, SOPHON_DIR, sha256 as checksum
from predict import sophon_adapter
from predict.base import Predictor

LOGGER = logging.getLogger(__name__)
MEASUREMENT_NAMES = ("jet_pt", "jet_energy", "jet_nparticles", *sophon_adapter.ARRAY_COLUMNS)
BUNDLE_FILES = ("model.onnx", "model.lock.json", "LICENSE",
                "Interacting_with_JetClassII_and_Sophon.ipynb", "JetClassII_full.yaml")


def validate_bundle(directory):
    """Check native weights, class mapping, adapter and publisher references."""
    directory = Path(directory)
    contract = json.loads((CONFIG_DIR / "sophon-contract.json").read_text())
    lock_path = CONFIG_DIR / "sophon-model.lock.json"
    if checksum(lock_path) != contract["model_lock_sha256"]:
        raise ValueError("Sophon model lock differs from its versioned contract.")
    if checksum(sophon_adapter.__file__) != contract["adapter_sha256"]:
        raise ValueError("Sophon tensor adapter differs from its versioned contract.")
    lock = json.loads(lock_path.read_text())
    if json.loads((directory / "model.lock.json").read_text()) != lock:
        raise ValueError("Sophon bundle metadata differs from the pinned publisher model.")
    artifact = directory / "model.onnx"
    if artifact.stat().st_size != lock["model"]["size_bytes"] or checksum(artifact) != lock["model"]["sha256"]:
        raise ValueError("Sophon model checksum differs from the pinned weights.")
    for name, expected in lock["upstream"]["files"].items():
        if checksum(directory / Path(name).name) != expected:
            raise ValueError(f"Sophon publisher reference changed: {name}.")
    return lock


class SophonPredictor(Predictor):
    """One loaded CPU session; labels and identifiers never enter its tensors."""

    kind = "sophon"
    model_file = "sophon/model.onnx"

    @classmethod
    def train(cls, rows, feature_names, params, directory, seed):
        if feature_names != list(MEASUREMENT_NAMES) or set(params) - {"model_dir"}:
            raise ValueError("Frozen Sophon requires the particles feature set and only optional model_dir.")
        source = Path(params.get("model_dir", SOPHON_DIR))
        lock = validate_bundle(source)
        (directory / "sophon").mkdir(parents=True)
        for filename in BUNDLE_FILES:
            shutil.copyfile(source / filename, directory / "sophon" / filename)
        return {"format": "sophon-onnx", "trained": False, "model_version": lock["contract_version"],
                "source": lock["model"], "score_semantics": lock["outputs"],
                "parameters": {"batch_size": 1, "threads": 1}}

    def __init__(self, directory, metadata):
        import onnxruntime as ort

        super().__init__(metadata)
        if metadata["feature_names"] != list(MEASUREMENT_NAMES):
            raise ValueError("Sophon measurement feature contract changed.")
        self.lock = validate_bundle(directory / "sophon")
        options = ort.SessionOptions()
        options.intra_op_num_threads = options.inter_op_num_threads = 1
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.session = ort.InferenceSession(str(directory / self.model_file), options,
                                            providers=["CPUExecutionProvider"])
        signature = {item.name: (item.type, item.shape) for item in self.session.get_inputs()}
        expected = {name: ("tensor(float)", shape) for name, shape in self.lock["native_input_signature"].items()}
        if signature != expected or self.session.get_providers() != ["CPUExecutionProvider"]:
            raise ValueError("Sophon CPU input contract differs from the pinned artifact.")
        output = self.session.get_outputs()
        if (len(output) != 1 or output[0].name != "softmax" or output[0].type != "tensor(float)"
                or output[0].shape != ["N", "Concatsoftmax_dim_1"]):
            raise ValueError("Unexpected Sophon output contract.")
        LOGGER.info("Loaded pinned Sophon on CPU with one thread and batch size one")

    def _predict(self, rows):
        scores = []
        for row in rows:
            combined = np.asarray(self.session.run(None, sophon_adapter.make_tensors([row]))[0])
            if combined.shape != (1, 316) or not np.isfinite(combined).all():
                raise ValueError("Sophon must return 188 probabilities and 128 finite latent features.")
            scores.append(float(sophon_adapter.conditional_signal_score(combined[:, :188])[0]))
        return np.asarray(scores, dtype=np.float64)
