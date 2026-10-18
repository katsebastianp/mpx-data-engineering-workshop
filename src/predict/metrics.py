"""Binary classification metrics for held-out predictions."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from numpy.typing import ArrayLike
    from workshop_types import Metrics

import math

import numpy as np


def classification_metrics(labels: ArrayLike, scores: ArrayLike, threshold: float = .5) -> Metrics:
    """Binary labels use 1=signal, 0=background; never pass raw JetClass labels."""
    from sklearn.metrics import average_precision_score, roc_auc_score

    truth, values = np.asarray(labels), np.asarray(scores, dtype=np.float64)
    if (truth.ndim != 1 or not len(truth) or values.shape != truth.shape or not np.isin(truth, [0, 1]).all()
            or not np.isfinite(values).all() or np.any((values < 0) | (values > 1))
            or isinstance(threshold, bool) or not isinstance(threshold, (int, float))
            or not math.isfinite(threshold) or not 0 <= threshold <= 1):
        raise ValueError("Metrics require aligned binary labels and finite probability-like scores.")
    positive, selected = truth == 1, values >= threshold
    tp, fp = int(np.sum(positive & selected)), int(np.sum(~positive & selected))
    fn, tn = int(np.sum(positive & ~selected)), int(np.sum(~positive & ~selected))
    both = bool(positive.any() and (~positive).any())
    return {"rows": len(truth), "signal_rows": tp + fn, "background_rows": tn + fp,
            "roc_auc": float(roc_auc_score(truth, values)) if both else None,
            "average_precision": float(average_precision_score(truth, values)) if positive.any() else None,
            "accuracy": (tp + tn) / len(truth), "f1": 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else 0.,
            "confusion": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
            "signal_retention": tp / (tp + fn) if tp + fn else None,
            "background_rejection": tn / (tn + fp) if tn + fp else None}
