"""Core setup verifies the pinned sample without optional model assets or downloads."""

import hashlib
import json
import builtins
import urllib.request

import pytest

from scripts import setup_workshop as setup
from scripts import prepare_data


def digest(value):
    return hashlib.sha256(value).hexdigest()


@pytest.fixture
def sample(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    splits = {split: {"sha256": digest(split.encode())} for split in ("train", "validation", "test")}
    identity = digest(json.dumps({key: entry["sha256"] for key, entry in sorted(splits.items())},
                                 sort_keys=True, separators=(",", ":")).encode())
    for split in splits:
        (raw / f"{split}.parquet").write_bytes(split.encode())
    manifest = {"dataset_id": identity, "splits": splits}
    (raw / "manifest.json").write_text(json.dumps(manifest))
    release = {"version": 1, "dataset_id": identity, "files": {
        path.name: {"sha256": setup.sha256(path), "size_bytes": path.stat().st_size} for path in raw.iterdir()}}
    lock = tmp_path / "sample.lock.json"
    lock.write_text(json.dumps(release))
    return raw, lock, manifest


def test_sample_matches_independent_release_lock_and_survives_gitkeep(sample):
    raw, lock, manifest = sample
    (raw / ".gitkeep").touch()
    assert setup.verify_sample(raw, lock) == manifest


def test_missing_or_renamed_download_names_exact_file_and_site(sample):
    raw, lock, _ = sample
    (raw / "train.parquet").rename(raw / "train (1).parquet")
    with pytest.raises(ValueError, match=r"Missing regular file:.*train.parquet") as error:
        setup.verify_sample(raw, lock)
    assert setup.SITE in str(error.value)
    assert "exact filenames" in str(error.value)


def test_modified_file_and_rehashed_downloaded_manifest_cannot_repin_release(sample):
    raw, lock, manifest = sample
    modified = b"replacement sample"
    (raw / "test.parquet").write_bytes(modified)
    manifest["splits"]["test"]["sha256"] = digest(modified)
    (raw / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="Checksum or size mismatch"):
        setup.verify_sample(raw, lock)
    assert (raw / "test.parquet").read_bytes() == modified


def test_sample_identity_must_match_verified_split_hashes(sample):
    raw, lock, manifest = sample
    manifest["dataset_id"] = "0" * 64
    (raw / "manifest.json").write_text(json.dumps(manifest))
    release = json.loads(lock.read_text())
    release["dataset_id"] = manifest["dataset_id"]
    release["files"]["manifest.json"] = {"sha256": setup.sha256(raw / "manifest.json"),
                                           "size_bytes": (raw / "manifest.json").stat().st_size}
    lock.write_text(json.dumps(release))
    with pytest.raises(ValueError, match="dataset identity"):
        setup.verify_sample(raw, lock)



def test_setup_validates_the_sample_without_models_or_network(tmp_path, monkeypatch):
    manifest = {"dataset_id": "fixture", "splits": {"train": {"rows": 4000},
                "validation": {"rows": 1000}, "test": {"rows": 1000}}}
    config = tmp_path / "config"
    config.mkdir()
    lock = config / "workshop-data.lock.json"
    lock.write_text('{"version": 1}')
    calls = []
    raw = tmp_path / "raw"
    monkeypatch.setattr(setup, "ROOT", tmp_path)
    monkeypatch.setattr(setup, "verify_sample", lambda path: manifest if path == raw else pytest.fail("Wrong sample path"))
    monkeypatch.setattr(prepare_data, "validate_bundle", lambda *args: calls.append(args))
    monkeypatch.setattr(urllib.request, "urlopen", lambda *args, **kwargs: pytest.fail("Setup must not download assets"))
    original_import = builtins.__import__
    def without_optional_models(name, *args, **kwargs):
        if name.startswith(("predict.sophon", "predict.xgboost")):
            pytest.fail("Setup must not import optional classifier implementations")
        return original_import(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", without_optional_models)
    result = setup.setup(raw)
    assert calls == [(raw, {"version": 1}, setup.sha256(lock))]
    assert result == {"dataset_id": "fixture", "rows": 6000, "status": "ready"}
    assert not (tmp_path / "models").exists()


@pytest.mark.parametrize("legacy_args", [[], ["--skip-sophon"]])
def test_cli_checks_only_data_with_current_or_legacy_commands(tmp_path, monkeypatch, capsys, legacy_args):
    calls = []
    def verify(raw):
        calls.append(raw)
        return {"dataset_id": "fixture", "rows": 6000, "status": "ready"}
    monkeypatch.setattr(setup, "setup", verify)
    assert setup.main(["--raw-dir", str(tmp_path), *legacy_args]) == 0
    assert calls == [tmp_path]
    assert json.loads(capsys.readouterr().out) == {"dataset_id": "fixture", "rows": 6000, "status": "ready"}


def test_cli_reports_missing_sample_without_creating_or_replacing_files(tmp_path, caplog):
    precious = tmp_path / "notes.txt"
    precious.write_text("keep me")
    assert setup.main(["--raw-dir", str(tmp_path)]) == 1
    assert "Missing regular file" in caplog.text and setup.SITE in caplog.text
    assert precious.read_text() == "keep me"
    assert list(tmp_path.iterdir()) == [precious]
