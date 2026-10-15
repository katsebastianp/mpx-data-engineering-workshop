"""Setup must reject mismatched downloads and install only pinned model bytes."""

import hashlib
import io
import json
import stat
import urllib.error

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


class Response(io.BytesIO):
    status = 200


def test_download_verifies_bytes_and_second_run_makes_no_request(tmp_path, monkeypatch):
    payload = b"pinned model"
    calls = []
    def fetch(request, timeout):
        calls.append(request.full_url)
        assert timeout == 120
        return Response(payload)
    monkeypatch.setattr(setup.urllib.request, "urlopen", fetch)
    destination = tmp_path / "model.onnx"
    for _ in range(2):
        setup.download_file("https://huggingface.co/pinned/model", destination, digest(payload), len(payload))
    assert destination.read_bytes() == payload
    assert calls == ["https://huggingface.co/pinned/model"]
    assert not list(tmp_path.glob("*.partial"))


def test_download_retries_transient_failure_then_publishes(tmp_path, monkeypatch):
    payload = b"pinned model"
    calls = []
    def fetch(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.URLError("temporary failure")
        return Response(payload)
    monkeypatch.setattr(setup.urllib.request, "urlopen", fetch)
    monkeypatch.setattr(setup.time, "sleep", lambda seconds: None)
    destination = tmp_path / "model.onnx"
    setup.download_file("https://huggingface.co/pinned/model", destination, digest(payload), len(payload))
    assert len(calls) == 2
    assert destination.read_bytes() == payload


@pytest.mark.parametrize("payload", [b"wrong value!", b"short", b"oversized unexpected body"])
def test_bad_download_is_never_published_and_temporary_files_removed(tmp_path, monkeypatch, payload):
    expected = b"pinned model"
    calls = []
    def fetch(*args, **kwargs):
        calls.append(1)
        return Response(payload)
    monkeypatch.setattr(setup.urllib.request, "urlopen", fetch)
    monkeypatch.setattr(setup.time, "sleep", lambda seconds: None)
    destination = tmp_path / "model.onnx"
    with pytest.raises(RuntimeError, match="Could not download verified model.onnx"):
        setup.download_file("https://huggingface.co/pinned/model", destination, digest(expected), len(expected))
    assert len(calls) == 3
    assert not destination.exists()
    assert not list(tmp_path.glob("*.partial"))


def test_existing_corrupt_model_is_preserved_without_network(tmp_path, monkeypatch):
    destination = tmp_path / "model.onnx"
    destination.write_bytes(b"user file")
    monkeypatch.setattr(setup.urllib.request, "urlopen", lambda *args, **kwargs: pytest.fail("No network on conflict"))
    with pytest.raises(ValueError, match="was not overwritten"):
        setup.download_file("https://huggingface.co/pinned/model", destination, digest(b"pinned model"), 12)
    assert destination.read_bytes() == b"user file"


def test_concurrent_file_cannot_be_overwritten(tmp_path):
    temporary = tmp_path / "download.partial"
    temporary.write_bytes(b"expected")
    destination = tmp_path / "model.onnx"
    destination.write_bytes(b"other file")
    with pytest.raises(ValueError, match="Checksum"):
        setup.publish_new_file(temporary, destination, digest(b"expected"))
    assert destination.read_bytes() == b"other file"


@pytest.mark.parametrize("filename", ["model.onnx", "model.lock.json"])
def test_published_model_and_metadata_are_readable_by_host_user(tmp_path, filename):
    temporary = tmp_path / "download.partial"
    temporary.write_bytes(b"verified asset")
    temporary.chmod(0o600)
    destination = tmp_path / filename
    setup.publish_new_file(temporary, destination, digest(b"verified asset"))
    assert stat.S_IMODE(destination.stat().st_mode) == 0o644
    assert destination.read_bytes() == b"verified asset"


@pytest.mark.parametrize("contents", [b"{truncated", b'{}', b"\xff"])
def test_bad_model_metadata_has_actionable_error_and_no_download(tmp_path, monkeypatch, contents):
    directory = tmp_path / "sophon"
    directory.mkdir()
    metadata = directory / "model.lock.json"
    metadata.write_bytes(contents)
    monkeypatch.setattr(setup.urllib.request, "urlopen", lambda *args, **kwargs: pytest.fail("No network on metadata conflict"))
    with pytest.raises(ValueError, match="Conflicting Sophon metadata.*was not overwritten"):
        setup.setup_sophon(directory)
    assert metadata.read_bytes() == contents


@pytest.mark.parametrize("skip_sophon", [False, True])
def test_setup_explicit_skip_keeps_data_validation_and_reports_model_status(tmp_path, monkeypatch, skip_sophon):
    manifest = {"dataset_id": "fixture", "splits": {"train": {"rows": 4000},
                "validation": {"rows": 1000}, "test": {"rows": 1000}}}
    calls = []
    monkeypatch.setattr(setup, "verify_sample", lambda path: manifest)
    monkeypatch.setattr(prepare_data, "validate_bundle", lambda *args: calls.append("data-validated"))
    def model(path):
        assert not skip_sophon, "Skip must not read or download model assets"
        calls.append("sophon-validated")
        return {"model": {"sha256": "pinned-model"}}
    monkeypatch.setattr(setup, "setup_sophon", model)
    result = setup.setup(tmp_path / "raw", tmp_path / "missing-model", skip_sophon=skip_sophon)
    assert calls == (["data-validated"] if skip_sophon else ["data-validated", "sophon-validated"])
    assert result["rows"] == 6000 and result["status"] == "ready"
    assert result["sophon_status"] == ("skipped" if skip_sophon else "verified")
    assert result["sophon_sha256"] == (None if skip_sophon else "pinned-model")


def test_optional_sophon_fails_clearly_when_setup_was_skipped(tmp_path):
    from predict.sophon import validate_bundle

    with pytest.raises(ValueError, match="Optional Sophon assets are missing.*without --skip-sophon"):
        validate_bundle(tmp_path / "missing-model")
