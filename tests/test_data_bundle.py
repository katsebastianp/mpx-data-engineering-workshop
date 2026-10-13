"""Data release checks use tiny real Parquet fixtures; no source network needed."""

import copy
import hashlib
import io
import importlib.util
import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

spec = importlib.util.spec_from_file_location("workshop_data_preparation", Path(__file__).resolve().parents[1] / "scripts/prepare_data.py")
preparation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparation)


@pytest.fixture
def source_lock(tmp_path):
    cache = tmp_path / "cache"
    cache.mkdir()
    lock = {"version": 1, "repository": "fixture/particles", "revision": "0" * 40,
            "seed": 42, "split_rows": {"train": 4, "validation": 4, "test": 4},
            "sampling": "fixture hash sampling", "source_verification": "verified fixture ranges", "files": []}
    for split in lock["split_rows"]:
        for group in ("signal", "background"):
            labels = [0, 0, 0, 1] if group == "signal" else [161, 178, 187, 0]
            rows = []
            for index, label in enumerate(labels):
                count = 129 if split == "validation" else 3
                row = {"jet_label": label, "jet_pt": 300.0 + index, "jet_energy": 600.0,
                       "jet_sdmass": 40.0, "jet_nparticles": count, "genpart_pid": [5, -5]}
                for name in preparation.ARRAY_COLUMNS:
                    row[name] = ([False] * count if name.startswith("part_is") else
                                 [1] * count if name == "part_charge" else
                                 [2.0] * count if name == "part_energy" else [0.1] * count)
                rows.append(row)
            path = tmp_path / f"{split}-{group}.parquet"
            pq.write_table(pa.Table.from_pylist(rows), path)
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            (cache / f"{digest}.range").write_bytes(data)
            lock["files"].append({"path": f"data/{split}-{group}.parquet", "split": split, "group": group,
                                  "size_bytes": len(data), "publisher_sha256": digest,
                                  "row_groups": [0], "row_count": len(rows), "eligible_rows": 3,
                                  "measurement_columns": list(preparation.measurement_columns(split)),
                                  "ranges": [{"start": 0, "length": len(data), "sha256": digest, "kind": "fixture"}]})
    lock_path = tmp_path / "workshop-data.lock.json"
    lock_path.write_text(json.dumps(lock))
    return lock_path, cache


def test_reproducible_bundle_disjoint_ids_and_full_measurements(tmp_path, source_lock):
    lock_path, cache = source_lock
    first = preparation.prepare(tmp_path / "first", cache, lock_path)
    second = preparation.prepare(tmp_path / "second", cache, lock_path)
    assert first == second
    assert len(first["dataset_id"]) == 64
    all_ids = set()
    for split in ("train", "validation", "test"):
        rows = pq.read_table(tmp_path / "first" / f"{split}.parquet").to_pylist()
        assert {row["split"] for row in rows} == {split}
        assert sum(row["truth_group"] == "signal" for row in rows) == 2
        assert sum(row["truth_group"] == "background" for row in rows) == 2
        ids = {row["record_id"] for row in rows}
        assert not ids.intersection(all_ids)
        all_ids.update(ids)
        for row in rows:
            raw_id = f"fixture/particles@{'0' * 40}:{row['source_file']}:{row['source_row']}"
            assert row["record_id"] == hashlib.sha256(raw_id.encode()).hexdigest()
            assert "genpart_pid" not in row and "jet_label" not in row
        if split == "train":
            assert "part_px" not in rows[0] and "jet_energy" not in rows[0]
        else:
            assert all(name in rows[0] for name in preparation.ARRAY_COLUMNS)
    validation = pq.read_table(tmp_path / "first/validation.parquet").to_pylist()
    assert all(len(row["part_energy"]) == 129 for row in validation)
    assert preparation.prepare(tmp_path / "first", cache, lock_path) == first


def test_modified_split_is_rejected_without_overwriting(tmp_path, source_lock):
    lock_path, cache = source_lock
    output = tmp_path / "bundle"
    preparation.prepare(output, cache, lock_path)
    (output / "test.parquet").write_bytes(b"modified")
    with pytest.raises(ValueError, match="checksum"):
        preparation.prepare(output, cache, lock_path)
    assert (output / "test.parquet").read_bytes() == b"modified"


def test_manifest_dataset_id_and_current_lock_are_checked(tmp_path, source_lock):
    lock_path, cache = source_lock
    output = tmp_path / "bundle"
    manifest = preparation.prepare(output, cache, lock_path)
    manifest["dataset_id"] = "0" * 64
    (output / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="dataset_id"):
        preparation.prepare(output, cache, lock_path)
    manifest["revision"] = "1" * 40
    (output / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="metadata"):
        preparation.prepare(output, cache, lock_path)


@pytest.mark.parametrize("field,value", [
    ("part_energy", [float("nan")]), ("part_deta", []),
    ("part_energy", [-1.0]), ("part_dphi", [4.0]),
    ("truth_group", "background"), ("split", "train"),
])
def test_bad_measurements_or_provenance_fail_closed(tmp_path, source_lock, field, value):
    lock_path, cache = source_lock
    lock = json.loads(lock_path.read_text())
    row = preparation.projected_sample(lock, lock["files"][-2], cache)[0]
    row[field] = value
    with pytest.raises(ValueError):
        preparation.validate_row(row, "test", lock)


def test_full_shard_response_is_rejected_without_reading_body(tmp_path, source_lock, monkeypatch):
    lock_path, _ = source_lock
    lock = json.loads(lock_path.read_text())
    entry = lock["files"][0]
    class FullResponse(io.BytesIO):
        status = 200
        headers = {}
        def read(self, *args):
            pytest.fail("A server ignoring Range must not cause a complete shard download")
    monkeypatch.setattr(preparation.urllib.request, "urlopen", lambda *args, **kwargs: FullResponse())
    monkeypatch.setattr(preparation.time, "sleep", lambda seconds: None)
    with pytest.raises(RuntimeError, match="no replacement data"):
        preparation.fetch_range(lock, entry, entry["ranges"][0], tmp_path / "uncached")


def test_locked_range_integrity_is_checked(tmp_path, source_lock, monkeypatch):
    lock_path, _ = source_lock
    lock = json.loads(lock_path.read_text())
    entry = lock["files"][0]
    span = entry["ranges"][0]
    size = span["length"]
    class WrongBytes(io.BytesIO):
        status = 206
        headers = {"Content-Range": f"bytes 0-{size - 1}/{size}"}
    monkeypatch.setattr(preparation.urllib.request, "urlopen", lambda *args, **kwargs: WrongBytes(b"x" * size))
    monkeypatch.setattr(preparation.time, "sleep", lambda seconds: None)
    with pytest.raises(RuntimeError):
        preparation.fetch_range(lock, entry, span, tmp_path / "uncached")
    assert not list((tmp_path / "uncached").glob("*.partial"))


def test_dataset_id_depends_on_split_hashes_not_json_order():
    first = {"train": {"sha256": "a"}, "validation": {"sha256": "b"}, "test": {"sha256": "c"}}
    reordered = dict(reversed(list(first.items())))
    assert preparation.dataset_id(first) == preparation.dataset_id(reordered)
    changed = copy.deepcopy(first)
    changed["test"]["sha256"] = "d"
    assert preparation.dataset_id(first) != preparation.dataset_id(changed)


def test_rehashed_file_still_cannot_move_records_between_splits(tmp_path, source_lock):
    lock_path, cache = source_lock
    output = tmp_path / "bundle"
    manifest = preparation.prepare(output, cache, lock_path)
    path = output / "validation.parquet"
    rows = pq.read_table(path).to_pylist()
    train = pq.read_table(output / "train.parquet").to_pylist()[0]
    for name in ("record_id", "source_file", "source_row"):
        rows[0][name] = train[name]
    pq.write_table(pa.Table.from_pylist(rows, schema=preparation.output_schema("validation")), path)
    manifest["splits"]["validation"]["sha256"] = preparation.sha256(path)
    manifest["dataset_id"] = preparation.dataset_id(manifest["splits"])
    (output / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="overlapping|official split"):
        preparation.prepare(output, cache, lock_path)


def test_canonical_reference_contains_only_held_out_ids_and_binary_truth(tmp_path, source_lock):
    lock_path, cache = source_lock
    raw = tmp_path / "raw"
    manifest = preparation.prepare(raw, cache, lock_path)
    destination = tmp_path / "config/evaluation.json"
    reference = preparation.write_evaluation_reference(raw, manifest, destination)
    assert set(reference) == {"version", "dataset_id", "splits"}
    assert reference["dataset_id"] == manifest["dataset_id"]
    assert set(reference["splits"]) == {"validation", "test"}
    train_ids = set(pq.read_table(raw / "train.parquet")["record_id"].to_pylist())
    for split, values in reference["splits"].items():
        source = pq.read_table(raw / f"{split}.parquet").to_pylist()
        assert values == [{"record_id": row["record_id"], "label": int(row["truth_label"] == 0)}
                          for row in sorted(source, key=lambda row: row["record_id"])]
        assert not train_ids.intersection(row["record_id"] for row in values)
    original = destination.read_bytes()
    assert preparation.write_evaluation_reference(raw, manifest, destination) == reference
    assert destination.read_bytes() == original
    reference["dataset_id"] = "0" * 64
    destination.write_text(json.dumps(reference))
    with pytest.raises(ValueError, match="reference changed"):
        preparation.write_evaluation_reference(raw, manifest, destination)
