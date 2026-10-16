"""Small synthetic fixtures exercise training contracts, never workshop quality."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import numpy as np
import pytest

from predict.base import Predictor, feature_matrix
from predict.logistic import LogisticPredictor
from predict.metrics import classification_metrics
from predict.models import load_model, train_model


def train_rows():
    return [{"split": "train", "record_id": f"train-{index}", "truth_label": 0 if index % 2 else 187,
             "jet_pt": 300. + index, "jet_sdmass": 100. if index % 2 else 10., "particle_count": 20. + index}
            for index in range(40)]


def test_real_fit_reload_json_and_label_free_prediction(tmp_path):
    kind = "logistic"
    rows = train_rows()
    params = {"C": 1.0}
    names = ["jet_pt", "jet_sdmass", "particle_count"]
    metadata = train_model(kind, rows, names, params, tmp_path / kind)
    model = load_model(metadata)
    assert isinstance(model, Predictor)
    assert isinstance(model, LogisticPredictor)
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


@pytest.mark.parametrize("params", [{"n_jobs": 8}, {"C": 0}, {"max_iter": 10000}, {"max_iter": 50.5}])
def test_model_parameters_are_bounded_cpu_options(tmp_path, params):
    with pytest.raises(ValueError):
        train_model("logistic", train_rows(), ["jet_pt"], params, tmp_path / "model")


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


@pytest.mark.parametrize("with_reference_pack", [False, True])
@pytest.mark.parametrize("with_participant_classifier", [False, True])
def test_registry_imports_extensions_and_discovers_optional_pack(
        tmp_path, with_reference_pack, with_participant_classifier):
    root = Path(__file__).resolve().parents[1]
    source = tmp_path / "starter"
    # Keep participant modules and their local imports; only the reference pack is optional.
    shutil.copytree(root / "src", source,
                    ignore=shutil.ignore_patterns("__pycache__", "sophon.py", "sophon_adapter.py"))
    package = source / "predict"
    if with_reference_pack:
        (package / "sophon.py").write_text(
            "from predict.logistic import LogisticPredictor\n"
            "MEASUREMENT_NAMES = ('jet_pt', 'part_energy')\n"
            "class SophonPredictor(LogisticPredictor):\n"
            "    kind = 'sophon'\n")
    from predict.models import PREDICTORS
    kind = "workshop-test-classifier"
    while kind in PREDICTORS:
        kind += "-extra"
    if with_participant_classifier:
        module = "workshop_test_classifier"
        while (package / f"{module}.py").exists():
            module += "_extra"
        (package / f"{module}.py").write_text(
            "from predict.logistic import LogisticPredictor\n"
            "class FixturePredictor(LogisticPredictor):\n"
            f"    kind = {kind!r}\n")
        with (package / "models.py").open("a") as stream:
            stream.write(f"\nfrom predict.{module} import FixturePredictor\n"
                         "PREDICTORS[FixturePredictor.kind] = FixturePredictor\n")
    script = """
import json
import sys
from predict.models import PREDICTORS, train_model, load_model
from predict.config import _feature_names
result = {'models': sorted(PREDICTORS), 'basic': _feature_names('logistic', 'basic'),
          'particles': _feature_names('sophon', 'particles') if 'sophon' in PREDICTORS else None}
if sys.argv[1]:
    rows = [{'split': 'train', 'record_id': f'train-{index}',
             'truth_label': 0 if index % 2 else 187, 'jet_pt': 300. + index,
             'jet_sdmass': 100. if index % 2 else 10., 'particle_count': 20. + index}
            for index in range(40)]
    metadata = train_model(sys.argv[1], rows, result['basic'], {}, sys.argv[2])
    scores = load_model(metadata).predict(rows)
    changed = [{**row, 'truth_label': 999, 'record_id': 'ignored'} for row in rows]
    result['extension'] = {'kind': metadata['kind'], 'trained': metadata['trained'],
                           'rows': metadata['training_rows'], 'scores': scores.tolist(),
                           'reloaded_scores': load_model(sys.argv[2]).predict(changed).tolist()}
print(json.dumps(result))
"""
    process = subprocess.run([sys.executable, "-B", "-c", script,
        kind if with_participant_classifier else "", str(tmp_path / "trained-extension")],
        capture_output=True, text=True, timeout=20,
        env={**os.environ, "PYTHONPATH": str(source), "PYTHONDONTWRITEBYTECODE": "1"})
    assert process.returncode == 0, process.stderr
    result = json.loads(process.stdout)
    assert "logistic" in result["models"]
    assert ("sophon" in result["models"]) == with_reference_pack
    assert set(PREDICTORS) - {"sophon"} <= set(result["models"])
    assert result["basic"] == ["jet_pt", "jet_sdmass", "particle_count"]
    assert result["particles"] == (["jet_pt", "part_energy"] if with_reference_pack else None)
    if with_participant_classifier:
        extension = result["extension"]
        assert extension["kind"] == kind and kind in result["models"]
        assert extension["trained"] is True and extension["rows"] == 40
        assert extension["scores"] == extension["reloaded_scores"]
        labels = [int(row["truth_label"] == 0) for row in train_rows()]
        assert classification_metrics(labels, extension["scores"])["roc_auc"] > .95
