"""Standardized logistic regression, saved as inspectable coefficients."""

import json
import warnings

import numpy as np
from scipy.special import expit
from threadpoolctl import threadpool_limits

from common import write_json
from predict.base import Predictor, feature_matrix, training_data, validate_parameters


class LogisticPredictor(Predictor):
    kind = "logistic"
    model_file = "logistic.json"

    def __init__(self, directory, metadata):
        super().__init__(metadata)
        feature_matrix([], metadata["feature_names"])
        self.coefficients = json.loads((directory / self.model_file).read_text())
        coefficients = self.coefficients
        size = len(metadata["feature_names"])
        if (coefficients["feature_names"] != metadata["feature_names"] or coefficients["classes"] != [0, 1]
                or any(len(coefficients[key]) != size for key in ("mean", "scale", "coefficients"))
                or not np.isfinite([*coefficients["mean"], *coefficients["scale"],
                                    *coefficients["coefficients"], coefficients["intercept"]]).all()
                or any(scale <= 0 for scale in coefficients["scale"])):
            raise ValueError("Invalid logistic coefficient or scaling contract.")

    @classmethod
    def train(cls, rows, feature_names, params, directory, seed):
        from sklearn.exceptions import ConvergenceWarning
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler

        values, labels = training_data(rows, feature_names)
        settings = validate_parameters(cls.kind, params, {"C": 1.0, "max_iter": 500},
                                       {"C": (1e-4, 1e4), "max_iter": (50, 2000)})
        directory.mkdir(parents=True)
        with threadpool_limits(limits=1):
            scaler = StandardScaler().fit(values)
            estimator = LogisticRegression(**settings, solver="lbfgs", penalty="l2", random_state=seed)
            with warnings.catch_warnings():
                warnings.simplefilter("error", ConvergenceWarning)
                estimator.fit(scaler.transform(values), labels)
        write_json(directory / cls.model_file, {
            "feature_names": feature_names, "mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist(),
            "coefficients": estimator.coef_[0].tolist(), "intercept": float(estimator.intercept_[0]),
            "classes": estimator.classes_.tolist(),
        })
        return {"format": "standardized-logistic-json", "trained": True, "parameters": settings}

    def _predict(self, rows):
        matrix = feature_matrix(rows, self.metadata["feature_names"])
        coefficients = self.coefficients
        # Avoid starting BLAS threads for this small row reduction.
        standardized = (matrix - coefficients["mean"]) / coefficients["scale"]
        return expit(np.sum(standardized * coefficients["coefficients"], axis=1) + coefficients["intercept"])
