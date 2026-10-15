"""The single-setting exercise must preserve every saved value, not just row counts."""

import json
import shutil

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from common import sha256
from scripts.compare_preprocessing import compare
from test_compare import comparison_files


@pytest.fixture
def outputs(comparison_files, tmp_path):
    before = comparison_files[0]
    after = tmp_path / "changed"
    shutil.copytree(before, after)
    for folder, seconds, partitions in ((before, 12.0, 64), (after, 10.0, 4)):
        path = folder / "manifest.json"
        value = json.loads(path.read_text())
        value.update(elapsed_seconds=seconds, spark={"shuffle_partitions": partitions, "scheduled_tasks": partitions + 4})
        path.write_text(json.dumps(value))
    return before, after


def test_equal_values_can_have_different_row_order_and_file_bytes(outputs):
    before, after = outputs
    path = after / "validation.parquet"
    rows = pq.read_table(path).to_pylist()
    pq.write_table(pa.Table.from_pylist(list(reversed(rows))), path)
    manifest_path = after / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["splits"]["validation"]["sha256"] = sha256(path)
    manifest_path.write_text(json.dumps(manifest))
    result = compare(before, after)
    assert result["equivalent"] is True
    assert result["rows"] == {"train": 128, "validation": 128, "test": 128}
    assert result["before"]["scheduled_tasks"] == 68 and result["after"]["scheduled_tasks"] == 8
    assert result["observed_speedup"] == 1.2


@pytest.mark.parametrize("column,replacement", [("jet_pt", 301.0), ("part_energy", [2., 2.])])
def test_same_counts_do_not_hide_changed_feature_or_particle_values(outputs, column, replacement):
    before, after = outputs
    path = after / "validation.parquet"
    rows = pq.read_table(path).to_pylist()
    rows[0][column] = replacement
    pq.write_table(pa.Table.from_pylist(rows), path)
    manifest_path = after / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["splits"]["validation"]["sha256"] = sha256(path)
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="values differ"):
        compare(before, after)


def test_changed_dataset_cannot_be_called_equivalent(outputs):
    before, after = outputs
    path = after / "manifest.json"
    manifest = json.loads(path.read_text())
    manifest["dataset_id"] = "different-dataset"
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="dataset_id changed"):
        compare(before, after)


def test_same_output_folder_cannot_be_its_own_baseline(outputs):
    with pytest.raises(ValueError, match="separate baseline"):
        compare(outputs[0], outputs[0])
