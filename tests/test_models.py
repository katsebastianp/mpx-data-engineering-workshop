"""Small synthetic fixtures exercise training contracts, never workshop quality."""

import json

import numpy as np
import pytest

from predict.base import Predictor, feature_matrix
from predict.logistic import LogisticPredictor
from predict.metrics import classification_metrics
from predict.models import load_model, train_model
from predict.xgboost import XGBoostPredictor


def train_rows():
    return [{"split": "train", "record_id": f"train-{index}", "truth_label": 0 if index % 2 else 187,
             "jet_pt": 300. + index, "jet_sdmass": 100. if index % 2 else 10., "particle_count": 20. + index}
            for index in range(40)]


@pytest.mark.parametrize("kind", ["logistic", "xgboost"])
def test_real_fit_reload_json_and_label_free_prediction(tmp_path, kind):
    rows = train_rows()
    params = {"n_estimators": 5, "max_depth": 2} if kind == "xgboost" else {"C": 1.0}
    names = ["jet_pt", "jet_sdmass", "particle_count"]
    metadata = train_model(kind, rows, names, params, tmp_path / kind)
    model = load_model(metadata)
    assert isinstance(model, Predictor)
    assert isinstance(model, LogisticPredictor if kind == "logistic" else XGBoostPredictor)
    scores = model.predict(rows)
    assert scores.shape == (40,)
    assert classification_metrics([int(row["truth_label"] == 0) for row in rows], scores)["roc_auc"] > .95
    changed = [{**row, "truth_label": 999, "truth_group": "wrong", "record_id": "ignored"} for row in rows]
    np.testing.assert_array_equal(scores, load_model(tmp_path / kind).predict(changed))
    assert not list((tmp_path / kind).rglob("*.pkl"))
    assert metadata["training_rows"] == 40
    with pytest.raises(ValueError, match="already exists"):
        train_model(kind, rows, names, params, tmp_path / kind)


def test_logistic_scaling_comes_only_from_training_rows(tmp_path):
    rows = train_rows()
    metadata = train_model("logistic", rows, ["jet_pt"], {}, tmp_path / "model")
    artifact = json.loads((tmp_path / "model/logistic.json").read_text())
    assert artifact["mean"] == [np.mean([row["jet_pt"] for row in rows])]
    load_model(metadata).predict([{"jet_pt": 1e6, "split": "validation"}])
    assert json.loads((tmp_path / "model/logistic.json").read_text())["mean"] == artifact["mean"]


def test_training_rejects_holdout_rows_and_leaking_features(tmp_path):
    rows = train_rows()
    for feature in ("truth_label", "truth_group", "split", "record_id", "source_row", "genjet_pt"):
        with pytest.raises(ValueError, match="feature|metadata|forbidden"):
            train_model("logistic", rows, [feature], {}, tmp_path / feature)
    rows[-1]["split"] = "test"
    with pytest.raises(ValueError, match="train split"):
        train_model("logistic", rows, ["jet_pt"], {}, tmp_path / "test-leak")


@pytest.mark.parametrize("kind,params", [("logistic", {"n_jobs": 8}), ("logistic", {"C": 0}),
    ("xgboost", {"max_depth": 100}), ("xgboost", {"device": "cuda"}), ("xgboost", {"n_estimators": 1.5})])
def test_model_parameters_are_bounded_cpu_options(tmp_path, kind, params):
    with pytest.raises(ValueError):
        train_model(kind, train_rows(), ["jet_pt"], params, tmp_path / "model")


def test_corrupt_native_model_fails_checksum_before_load(tmp_path):
    metadata = train_model("logistic", train_rows(), ["jet_pt"], {}, tmp_path / "model")
    (tmp_path / "model/logistic.json").write_text("{}")
    with pytest.raises(ValueError, match="checksum"):
        load_model(metadata)


def test_metrics_distinguish_confusion_and_undefined_single_class_auc():
    result = classification_metrics([1, 1, 0, 0], [.9, .4, .6, .1])
    assert result["confusion"] == {"tn": 1, "fp": 1, "fn": 1, "tp": 1}
    assert result["roc_auc"] == .75
    assert result["signal_retention"] == result["background_rejection"] == .5
    assert classification_metrics([0, 0], [.1, .2])["roc_auc"] is None
    with pytest.raises(ValueError):
        classification_metrics([0, 187], [.1, .2])
    with pytest.raises(ValueError):
        feature_matrix([{"jet_pt": float("nan")}], ["jet_pt"])


@pytest.mark.parametrize("split", ["validation", "test"])
def test_registry_dispatch_rejects_non_train_rows_before_new_classifier_runs(tmp_path, monkeypatch, split):
    from predict.models import PREDICTORS

    class UncalledPredictor(LogisticPredictor):
        kind = "new-classifier"

        @classmethod
        def train(cls, *args):
            pytest.fail("New classifiers must receive only valid training rows")

    monkeypatch.setitem(PREDICTORS, UncalledPredictor.kind, UncalledPredictor)
    rows = train_rows()
    rows[-1]["split"] = split
    with pytest.raises(ValueError, match="train split"):
        train_model(UncalledPredictor.kind, rows, ["jet_pt"], {}, tmp_path / "never-created")
    assert not (tmp_path / "never-created").exists()


def test_inference_receives_measurements_only_even_for_new_classifier():
    class InspectingPredictor(Predictor):
        kind = "new-classifier"
        model_file = "unused.json"

        @classmethod
        def train(cls, *args):
            raise NotImplementedError

        def _predict(self, rows):
            assert rows == [{"jet_pt": 300.0}, {"jet_pt": 301.0}]
            return [.2, .8]

    model = InspectingPredictor({"feature_names": ["jet_pt"]})
    np.testing.assert_array_equal(model.predict(train_rows()[:2]), [.2, .8])
    with pytest.raises(ValueError, match="feature|metadata|forbidden"):
        InspectingPredictor({"feature_names": ["truth_label"]})
