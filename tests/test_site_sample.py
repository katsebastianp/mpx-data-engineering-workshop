"""Publish only the pinned sample; rejected inputs leave existing assets intact."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest

from scripts.stage_site_sample import stage_sample


@pytest.fixture
def sample(tmp_path):
    source = tmp_path / "raw"
    source.mkdir()
    files = {f"{split}.parquet": f"fixture {split}".encode() for split in ("train", "validation", "test")}
    identity = hashlib.sha256(json.dumps(
        {name.removesuffix(".parquet"): hashlib.sha256(data).hexdigest() for name, data in files.items()},
        sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    files["manifest.json"] = json.dumps({"dataset_id": identity}).encode()
    for name, data in files.items():
        (source / name).write_bytes(data)
    lock = tmp_path / "sample.lock.json"
    lock.write_text(json.dumps({"version": 1, "dataset_id": identity, "files": {
        name: {"sha256": hashlib.sha256(data).hexdigest(), "size_bytes": len(data)}
        for name, data in files.items()}}))
    return source, tmp_path / "public/downloads/jetclass2-v1", lock, files


def test_stages_only_verified_sample_files_and_is_repeatable(sample):
    source, output, lock, files = sample
    (source / ".gitkeep").write_text("")
    (source / "unrelated-private-data.json").write_text("must not publish")
    first = stage_sample(source, output, lock)
    assert first == stage_sample(source, output, lock)
    assert first["verified"] is True
    assert first["size_bytes"] == sum(map(len, files.values()))
    assert {path.name: path.read_bytes() for path in output.iterdir()} == files


@pytest.mark.parametrize("problem", ["missing", "corrupt", "symlink"])
def test_bad_inputs_leave_existing_downloads_unchanged(sample, problem):
    source, output, lock, files = sample
    stage_sample(source, output, lock)
    path = source / "validation.parquet"
    path.unlink()
    if problem == "corrupt":
        path.write_bytes(b"bad download")
    elif problem == "symlink":
        path.symlink_to(output / path.name)
    with pytest.raises(ValueError, match="regular|Checksum"):
        stage_sample(source, output, lock)
    assert {path.name: path.read_bytes() for path in output.iterdir()} == files
    assert sorted(path.name for path in output.parent.iterdir()) == [output.name]


def test_unexpected_files_in_destination_block_publication(sample):
    source, output, lock, _ = sample
    output.mkdir(parents=True)
    private_file = output / "other.json"
    private_file.write_text("needs maintainer attention")
    with pytest.raises(ValueError, match="Unexpected file"):
        stage_sample(source, output, lock)
    assert list(output.iterdir()) == [private_file]


def test_different_release_identity_is_rejected_before_publication(sample):
    source, output, lock, _ = sample
    release = json.loads(lock.read_text())
    release["dataset_id"] = "0" * 64
    lock.write_text(json.dumps(release))
    with pytest.raises(ValueError, match="dataset identity"):
        stage_sample(source, output, lock)
    assert not output.exists()


def test_direct_cli_needs_only_the_python_standard_library(sample, tmp_path):
    source, output, lock, files = sample
    script = Path(__file__).resolve().parents[1] / "scripts/stage_site_sample.py"
    result = subprocess.run(
        [sys.executable, "-I", "-S", str(script), "--source", str(source),
         "--output", str(output), "--lock", str(lock)],
        cwd=tmp_path, text=True, capture_output=True, check=True,
    )
    assert json.loads(result.stdout)["verified"] is True
    assert {path.name: path.read_bytes() for path in output.iterdir()} == files
