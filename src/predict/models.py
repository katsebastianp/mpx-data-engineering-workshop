"""Select predictors and read or write their shared artifact manifest."""

import json
import logging
from pathlib import Path

from common import sha256, write_json
from predict.base import Predictor, training_data
from predict.logistic import LogisticPredictor
from predict.sophon import SophonPredictor
from predict.xgboost import XGBoostPredictor

LOGGER = logging.getLogger(__name__)
# Extension point: implement Predictor in its own module, import it above, and
# add its class here. Configuration, training and reload use this one registry.
# Keep model files portable (e.g. JSON/ONNX), CPU settings bounded and fits seeded.
PREDICTORS = {model.kind: model for model in (LogisticPredictor, XGBoostPredictor, SophonPredictor)}


def train_model(kind, rows, feature_names, params, output_dir, seed=42):
    if kind not in PREDICTORS:
        raise ValueError(f"Unknown model: {kind}.")
    if not isinstance(params, dict):
        raise ValueError("Model params must be a mapping.")
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2**31 - 1:
        raise ValueError("seed must be an integer in [0, 2147483647].")
    directory = Path(output_dir)
    if directory.exists():
        raise ValueError(f"Model output already exists: {directory}; choose a new run ID.")
    predictor = PREDICTORS[kind]
    names = list(feature_names)
    if kind != "sophon":
        # Apply the same split/label/feature checks to new registered classifiers.
        training_data(rows, names)
        rows = [{name: row[name] for name in (*names, "truth_label", "split")} for row in rows]
    metadata = predictor.train(rows, names, params, directory, seed)
    if type(metadata.get("trained")) is not bool:
        raise ValueError("Predictor metadata must explicitly declare trained: true or false.")
    metadata.update(version=1, kind=kind, feature_names=names, seed=seed, model_file=predictor.model_file,
                    model_sha256=sha256(directory / predictor.model_file),
                    training_rows=len(rows) if metadata["trained"] else 0)
    write_json(directory / "manifest.json", metadata)
    LOGGER.info("Prepared %s model in %s (trained=%s)", kind, directory, metadata["trained"])
    return {**metadata, "model_dir": str(directory.resolve())}


def load_model(model) -> Predictor:
    directory = Path(model["model_dir"] if isinstance(model, dict) else model)
    metadata = json.loads((directory / "manifest.json").read_text())
    predictor = PREDICTORS.get(metadata.get("kind"))
    if metadata.get("version") != 1 or predictor is None or metadata.get("model_file") != predictor.model_file:
        raise ValueError("Model artifact has an incompatible format or path.")
    if sha256(directory / predictor.model_file) != metadata["model_sha256"]:
        raise ValueError("Model artifact checksum mismatch.")
    return predictor(directory, metadata)
