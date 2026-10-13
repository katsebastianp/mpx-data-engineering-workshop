"""Tiny Spark flow and fail-closed raw file/split contract checks."""

import hashlib
import json
import math
from pathlib import Path
import sys
from types import SimpleNamespace

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from preprocessing import pipeline as preprocess

PARTICLE_ARRAYS = (
    "part_px", "part_py", "part_pz", "part_energy", "part_deta", "part_dphi",
    "part_charge", "part_d0val", "part_d0err", "part_dzval", "part_dzerr",
    "part_isElectron", "part_isMuon", "part_isPhoton", "part_isChargedHadron", "part_isNeutralHadron",
)


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest_identity(splits):
    payload = {name: details["sha256"] for name, details in sorted(splits.items())}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def make_jet(split, group):
    signal = group == "signal"
    count = 2 if signal else 129
    row = {"record_id": f"{split}-{group}", "source_file": f"fixture/{split}.parquet",
           "source_row": 0 if signal else 1, "truth_label": 0 if signal else 187,
           "truth_group": group, "split": split,
           "jet_pt": 300.0 if signal else 2500.0 if split == "test" else 200.0,
           "jet_sdmass": 40.0 if signal else 500.0 if split == "test" else 20.0,
           "jet_nparticles": count, "part_energy": [1.0, 3.0] if signal else [1.0] * count,
           "part_deta": [0.0, 0.4] if signal else [0.0] * count,
           "part_dphi": [0.0] * count}
    if split != "train":
        row["jet_energy"] = 600.0
        for name in PARTICLE_ARRAYS:
            if name not in row:
                row[name] = ([False] * count if name.startswith("part_is") else
                             [1] * count if name == "part_charge" else [0.1] * count)
    return row


def rewrite_split(directory, split, rows):
    """Rehash deliberately malformed fixtures to reach semantic checks."""
    path = directory / f"{split}.parquet"
    pq.write_table(pa.Table.from_pylist(rows), path)
    manifest = json.loads((directory / "manifest.json").read_text())
    manifest["splits"][split] = {"file": path.name, "rows": len(rows), "sha256": checksum(path)}
    manifest["dataset_id"] = manifest_identity(manifest["splits"])
    (directory / "manifest.json").write_text(json.dumps(manifest))


@pytest.fixture
def raw_bundle(tmp_path):
    directory = tmp_path / "raw"
    directory.mkdir()
    splits = {}
    for split in ("train", "validation", "test"):
        path = directory / f"{split}.parquet"
        pq.write_table(pa.Table.from_pylist([make_jet(split, "signal"), make_jet(split, "background")]), path)
        splits[split] = {"file": path.name, "rows": 2, "sha256": checksum(path)}
    manifest = {"version": 1, "dataset_id": manifest_identity(splits), "splits": splits}
    (directory / "manifest.json").write_text(json.dumps(manifest))
    return directory


def test_valid_raw_bundle_has_exact_split_files(raw_bundle):
    manifest = preprocess.check_inputs(raw_bundle)
    assert {name: details["rows"] for name, details in manifest["splits"].items()} == {
        "train": 2, "validation": 2, "test": 2,
    }


def test_scheduled_tasks_count_shared_stages_once():
    tracker = SimpleNamespace(
        getJobIdsForGroup=lambda group: [3, 4],
        getJobInfo=lambda job: SimpleNamespace(stageIds={3: [1, 2], 4: [2, 3]}[job]),
        getStageInfo=lambda stage: SimpleNamespace(numTasks={1: 2, 2: 8, 3: 1}[stage]),
    )
    assert preprocess.execution_counts(SimpleNamespace(statusTracker=lambda: tracker)) == {
        "job_count": 2, "stage_count": 3, "scheduled_tasks": 11,
    }


def test_changed_parquet_is_rejected_before_jvm_start(raw_bundle):
    (raw_bundle / "test.parquet").write_bytes(b"changed")
    with pytest.raises(ValueError, match="checksum"):
        preprocess.check_inputs(raw_bundle)


@pytest.mark.parametrize("problem", ["duplicate", "overlap", "wrong_split", "wrong_truth"])
def test_rehashed_semantic_errors_are_rejected(raw_bundle, problem):
    rows = pq.read_table(raw_bundle / "validation.parquet").to_pylist()
    if problem == "duplicate":
        rows[1]["record_id"] = rows[0]["record_id"]
    elif problem == "overlap":
        rows[0]["record_id"] = "train-signal"
    elif problem == "wrong_split":
        rows[0]["split"] = "test"
    else:
        rows[0]["truth_group"] = "background"
    rewrite_split(raw_bundle, "validation", rows)
    with pytest.raises(ValueError, match="duplicated|overlap|split|truth"):
        preprocess.check_inputs(raw_bundle)


@pytest.mark.parametrize("problem", ["missing_split", "unexpected_path", "row_count"])
def test_manifest_file_contract_is_enforced(raw_bundle, problem):
    path = raw_bundle / "manifest.json"
    manifest = json.loads(path.read_text())
    if problem == "missing_split":
        del manifest["splits"]["test"]
    elif problem == "unexpected_path":
        manifest["splits"]["test"]["file"] = "../test.parquet"
    else:
        manifest["splits"]["test"]["rows"] = 99
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="Expected|filename|missing"):
        preprocess.check_inputs(raw_bundle)


@pytest.mark.integration
def test_spark_preparation_preserves_measurements_and_calculates_known_features(raw_bundle, tmp_path, monkeypatch):
    pytest.importorskip("pyspark")
    # Keep the test's execution history out of participant results and preserve
    # the real feature-source hash that prepare_data records for reproducibility.
    test_root = tmp_path / "workshop"
    test_root.mkdir()
    (test_root / "src/preprocessing").mkdir(parents=True)
    (test_root / "src/preprocessing/features.py").write_bytes((ROOT / "src/preprocessing/features.py").read_bytes())
    monkeypatch.setattr(preprocess, "ROOT", test_root)
    monkeypatch.setattr(preprocess, "SHUFFLE_PARTITIONS", 2)
    output = tmp_path / "prepared"
    result = preprocess.prepare_data(raw_bundle, output)
    original_manifest = json.loads((raw_bundle / "manifest.json").read_text())
    assert result["dataset_id"] == original_manifest["dataset_id"]
    assert result["raw_manifest_sha256"] == checksum(raw_bundle / "manifest.json")
    assert result["feature_source_sha256"] == checksum(ROOT / "src/preprocessing/features.py")
    assert result["spark"]["scheduled_tasks"] > 0
    assert result["spark"]["job_count"] > 0
    assert result["jets_per_second"] == pytest.approx(6 / result["elapsed_seconds"], abs=.001)
    expected = {"jet_pt": 300.0, "jet_sdmass": 40.0, "particle_count": 2.0,
                "energy_sum": 4.0, "leading_energy_fraction": 0.75,
                "radial_energy_moment": 0.3, "energy_dispersion": math.sqrt(0.625), "ecf2_beta1": 0.075}
    for split in ("train", "validation", "test"):
        path = output / result["splits"][split]["file"]
        assert checksum(path) == result["splits"][split]["sha256"]
        rows = {row["record_id"]: row for row in pq.read_table(path).to_pylist()}
        assert set(rows) == {f"{split}-signal", f"{split}-background"}
        signal = rows[f"{split}-signal"]
        assert {name: signal[name] for name in expected} == pytest.approx(expected)
        assert signal["truth_label"] == 0 and signal["truth_group"] == "signal"
        assert signal["in_training_support"] is True and signal["particles_truncated"] is False
        background = rows[f"{split}-background"]
        assert background["in_training_support"] is False  # Strict training-domain boundaries.
        assert background["particles_truncated"] is True
        assert len(background["part_energy"]) == 129  # Flag describes model use; preparation retains full arrays.
        assert background["energy_dispersion"] == pytest.approx(1 / math.sqrt(129))
        assert background["ecf2_beta1"] == 0.0
        if split != "train":
            original = {row["record_id"]: row for row in pq.read_table(raw_bundle / f"{split}.parquet").to_pylist()}
            for identity, row in rows.items():
                for name in PARTICLE_ARRAYS:
                    assert row[name] == original[identity][name]
    assert (output / "plan.txt").is_file()
    assert len(list((test_root / "data/05_analytics/preprocessing").glob("*.json"))) == 1


def test_dataset_identity_must_match_split_content(raw_bundle):
    path = raw_bundle / "manifest.json"
    manifest = json.loads(path.read_text())
    manifest["dataset_id"] = "0" * 64
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="dataset_id|identity"):
        preprocess.check_inputs(raw_bundle)


@pytest.mark.parametrize("identifier", [None, ""])
def test_record_ids_must_be_nonempty_strings(raw_bundle, identifier):
    rows = pq.read_table(raw_bundle / "train.parquet").to_pylist()
    rows[0]["record_id"] = identifier
    rewrite_split(raw_bundle, "train", rows)
    with pytest.raises(ValueError, match="missing|ID|identifier|record_id|nonempty"):
        preprocess.check_inputs(raw_bundle)


def test_empty_split_is_rejected_before_spark(raw_bundle):
    path = raw_bundle / "train.parquet"
    table = pq.read_table(path).slice(0)
    pq.write_table(table, path)
    manifest_path = raw_bundle / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["splits"]["train"].update(rows=0, sha256=checksum(path))
    manifest["dataset_id"] = manifest_identity(manifest["splits"])
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="empty|at least|positive|rows"):
        preprocess.check_inputs(raw_bundle)


def test_failed_output_replacement_restores_previous_data(tmp_path, monkeypatch):
    output = tmp_path / "prepared"
    output.mkdir()
    (output / "train.parquet").write_bytes(b"previous data")
    temporary = tmp_path / "temporary"
    temporary.mkdir()
    rename = Path.rename

    def fail_replacement(path, target):
        if path == temporary:
            raise OSError("Replacement failed")
        return rename(path, target)

    monkeypatch.setattr(Path, "rename", fail_replacement)
    with pytest.raises(OSError, match="Replacement failed"):
        preprocess._replace_output(temporary, output)

    assert (output / "train.parquet").read_bytes() == b"previous data"
    assert not (tmp_path / ".prepared-previous").exists()
