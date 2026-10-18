"""Predictor interface and shared tabular input validation."""

from __future__ import annotations

from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence
    from numpy.typing import NDArray
    from workshop_types import NumericParameters, Parameters, Record, Rows

from abc import ABC, abstractmethod
import math
from pathlib import Path

import numpy as np

from preprocessing.features import validate_feature_names


class Predictor(ABC):
    kind: str
    model_file: str

    def __init__(self, metadata: Record) -> None:
        self.metadata = metadata
        if self.kind != "sophon":
            validate_feature_names(metadata["feature_names"])

    @classmethod
    @abstractmethod
    def train(cls, rows: Rows, feature_names: list[str], params: Parameters, directory: Path, seed: int) -> Record:
        """Write the model artifact and return its model-specific metadata."""

    def predict(self, rows: Rows) -> NDArray[np.float64]:
        # Every classifier receives only its declared measurements at inference.
        # This also protects a participant's new implementation from accidentally
        # reading truth labels, record IDs or the split from the supplied rows.
        measured = [{name: row.get(name) for name in self.metadata["feature_names"]} for row in rows]
        scores = np.asarray(self._predict(measured), dtype=np.float64)
        if scores.shape != (len(rows),) or not np.isfinite(scores).all() or np.any((scores < 0) | (scores > 1)):
            raise ValueError("Model must return one finite score in [0, 1] per jet.")
        return scores

    @abstractmethod
    def _predict(self, rows: Rows) -> NDArray[np.float64]:
        """Score measured inputs without using labels or identifiers."""


def feature_matrix(rows: Rows, feature_names: Sequence[str]) -> NDArray[np.float64]:
    names = validate_feature_names(feature_names)
    matrix = []
    for row in rows:
        values = [row.get(name) for name in names]
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in values):
            raise ValueError("Model features must be finite numbers; rerun preprocessing for missing values.")
        matrix.append(values)
    return np.asarray(matrix, dtype=np.float64).reshape(len(rows), len(names))


def training_data(rows: Rows, feature_names: Sequence[str]) -> tuple[NDArray[np.float64], list[int]]:
    if not rows or any(row.get("split") != "train" for row in rows):
        raise ValueError("Training accepts only rows from the official prepared train split.")
    labels = []
    for row in rows:
        label = row.get("truth_label")
        if isinstance(label, bool) or not isinstance(label, int) or label not in (0, *range(161, 188)):
            raise ValueError("Training labels must be Xbb or documented QCD labels.")
        labels.append(int(label == 0))
    if set(labels) != {0, 1}:
        raise ValueError("Training requires both signal and background rows.")
    return feature_matrix(rows, feature_names), labels


def validate_parameters(
    kind: str,
    params: Parameters,
    defaults: NumericParameters,
    limits: Mapping[str, tuple[float, float]],
) -> NumericParameters:
    if set(params) - set(defaults):
        raise ValueError(f"Unsupported {kind} params: {sorted(set(params) - set(defaults))}.")
    values = {**defaults, **params}
    for name, value in values.items():
        low, high = limits[name]
        integer = isinstance(defaults[name], int)
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                or not low <= value <= high or (integer and not isinstance(value, int))):
            expected = "an integer" if integer else "a number"
            raise ValueError(f"{kind} {name} must be {expected} in [{low}, {high}].")
    return cast("NumericParameters", values)
