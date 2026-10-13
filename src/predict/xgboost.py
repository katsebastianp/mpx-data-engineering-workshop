"""CPU XGBoost training and inference using its native model format."""

import json

from threadpoolctl import threadpool_limits

from predict.base import Predictor, feature_matrix, training_data, validate_parameters


class XGBoostPredictor(Predictor):
    kind = "xgboost"
    model_file = "model.json"

    def __init__(self, directory, metadata):
        import xgboost as xgb

        super().__init__(metadata)
        feature_matrix([], metadata["feature_names"])
        self.booster = xgb.Booster(params={"nthread": 1, "device": "cpu"})
        self.booster.load_model(directory / self.model_file)
        self.booster.set_param({"nthread": 1, "device": "cpu"})
        objective = json.loads(self.booster.save_config())["learner"]["objective"]["name"]
        if (self.booster.num_features() != len(metadata["feature_names"])
                or self.booster.feature_names != metadata["feature_names"] or objective != "binary:logistic"):
            raise ValueError("XGBoost model does not match its binary feature contract.")

    @classmethod
    def train(cls, rows, feature_names, params, directory, seed):
        import xgboost as xgb

        values, labels = training_data(rows, feature_names)
        settings = validate_parameters(cls.kind, params, {
            "n_estimators": 100, "max_depth": 3, "learning_rate": .1, "subsample": 1.0,
            "colsample_bytree": 1.0, "min_child_weight": 1.0, "reg_lambda": 1.0,
        }, {
            "n_estimators": (1, 500), "max_depth": (1, 8), "learning_rate": (.001, 1),
            "subsample": (.1, 1), "colsample_bytree": (.1, 1), "min_child_weight": (0, 100), "reg_lambda": (0, 100),
        })
        directory.mkdir(parents=True)
        with threadpool_limits(limits=1):
            estimator = xgb.XGBClassifier(**settings, objective="binary:logistic", tree_method="hist",
                                          n_jobs=1, random_state=seed, device="cpu", eval_metric="logloss")
            estimator.fit(values, labels)
            estimator.get_booster().feature_names = feature_names
            estimator.save_model(directory / cls.model_file)
        return {"format": "xgboost-native-json", "trained": True, "parameters": settings}

    def _predict(self, rows):
        return self.booster.inplace_predict(feature_matrix(rows, self.metadata["feature_names"]))
