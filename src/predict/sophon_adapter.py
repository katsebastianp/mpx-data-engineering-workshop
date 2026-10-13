"""Measured-particle tensors for the pinned publisher Sophon ONNX model."""

from __future__ import annotations

import numpy as np

ARRAY_COLUMNS = (
    "part_px", "part_py", "part_pz", "part_energy", "part_deta", "part_dphi",
    "part_charge", "part_d0val", "part_d0err", "part_dzval", "part_dzerr",
    "part_isElectron", "part_isMuon", "part_isPhoton", "part_isChargedHadron",
    "part_isNeutralHadron",
)
FEATURE_TRANSFORMS = (
    ("part_pt_scale_log", 1.7, 0.7, -5, 5),
    ("part_e_scale_log", 2.0, 0.7, -5, 5),
    ("part_logptrel", -4.7, 0.7, -5, 5),
    ("part_logerel", -4.7, 0.7, -5, 5),
    ("part_deltaR", 0.2, 4.0, -5, 5),
    ("part_charge", 0, 1, -1e8, 1e8),
    ("part_isChargedHadron", 0, 1, -1e8, 1e8),
    ("part_isNeutralHadron", 0, 1, -1e8, 1e8),
    ("part_isPhoton", 0, 1, -1e8, 1e8),
    ("part_isElectron", 0, 1, -1e8, 1e8),
    ("part_isMuon", 0, 1, -1e8, 1e8),
    ("part_d0", 0, 1, -1e8, 1e8),
    ("part_d0err", 0, 1, 0, 1),
    ("part_dz", 0, 1, -1e8, 1e8),
    ("part_dzerr", 0, 1, 0, 1),
    ("part_deta", 0, 1, -1e8, 1e8),
    ("part_dphi", 0, 1, -1e8, 1e8),
)
VECTOR_TRANSFORMS = tuple(
    (f"part_{name}_scale", 0, 1, -1e8, 1e8)
    for name in ("px", "py", "pz", "energy")
)


def make_tensors(rows: list[dict]) -> dict[str, np.ndarray]:
    """Match upstream inference: source order, float32, first128, masked zero pad.

    Metadata, labels and generator truth cannot enter the explicitly named inputs.
    Raw nonfinite values fail. Log(0) becomes -inf and clips to -5, exactly as in
    the publisher notebook; it is not an invented replacement particle energy.
    """
    if not rows:
        raise ValueError("At least one measured jet is required")
    tensors = {
        "pf_features": np.zeros((len(rows), 17, 128), dtype=np.float32),
        "pf_vectors": np.zeros((len(rows), 4, 128), dtype=np.float32),
        "pf_mask": np.zeros((len(rows), 1, 128), dtype=np.float32),
    }
    for index, row in enumerate(rows):
        count = row["jet_nparticles"]
        if isinstance(count, bool) or int(count) != count or count <= 0:
            raise ValueError("jet_nparticles must be a positive integer")
        count = int(count)
        jet_pt, jet_energy = float(row["jet_pt"]), float(row["jet_energy"])
        if not np.isfinite([jet_pt, jet_energy]).all() or min(jet_pt, jet_energy) <= 0:
            raise ValueError("jet_pt and jet_energy must be finite and positive")
        values = {}
        for name in ARRAY_COLUMNS:
            array = np.asarray(row[name], dtype=np.float32)
            if array.shape != (count,) or not np.isfinite(array).all():
                raise ValueError(f"{name} must contain {count} finite aligned values")
            values[name] = array
        if (values["part_energy"] < 0).any():
            raise ValueError("Particle energy cannot be negative")
        for name in ("px", "py", "pz", "energy"):
            values[f"part_{name}_scale"] = values[f"part_{name}"] / jet_pt * 500
        with np.errstate(divide="ignore", invalid="raise"):
            values["part_pt_scale_log"] = np.log(np.hypot(values["part_px_scale"], values["part_py_scale"]))
            values["part_e_scale_log"] = np.log(values["part_energy_scale"])
            values["part_logptrel"] = np.log(np.hypot(values["part_px"], values["part_py"]) / jet_pt)
            values["part_logerel"] = np.log(values["part_energy"] / jet_energy)
        values["part_deltaR"] = np.hypot(values["part_deta"], values["part_dphi"])
        values["part_d0"] = np.tanh(values["part_d0val"])
        values["part_dz"] = np.tanh(values["part_dzval"])
        length = min(count, 128)
        for tensor_name, transforms in (("pf_features", FEATURE_TRANSFORMS), ("pf_vectors", VECTOR_TRANSFORMS)):
            for channel, (name, subtract, multiply, low, high) in enumerate(transforms):
                transformed = (values[name][:length] - subtract) * multiply
                tensors[tensor_name][index, channel, :length] = np.clip(transformed, low, high)
        tensors["pf_mask"][index, 0, :length] = 1
    if not all(np.isfinite(array).all() for array in tensors.values()):
        raise ValueError("Tensor preprocessing produced a nonfinite value")
    return tensors


def conditional_signal_score(probabilities: np.ndarray) -> np.ndarray:
    """Return the defined Xbb/(Xbb+QCD) discriminant, not calibrated prevalence."""
    values = np.asarray(probabilities)
    if values.ndim != 2 or values.shape[1] != 188:
        raise ValueError("Expected the publisher's 188 ordered class outputs")
    if not np.isfinite(values).all() or (values < 0).any() or (values > 1).any():
        raise ValueError("Class outputs must be finite probabilities in [0,1]")
    if not np.allclose(values.sum(axis=1), 1, rtol=1e-5, atol=1e-6):
        raise ValueError("Class outputs do not sum to one; refusing unverified logits")
    # Accumulate the conditional denominator in float64, avoiding batch-dependent
    # reduction rounding; the original ONNX class outputs remain available.
    values = values.astype(np.float64)
    denominator = values[:, 0] + values[:, 161:188].sum(axis=1)
    if (denominator <= 0).any():
        raise ValueError("Undefined conditional score: zero Xbb+QCD mass")
    return values[:, 0] / denominator
