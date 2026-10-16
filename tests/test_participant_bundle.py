"""Portable ZIP integrity, deterministic packaging and explicit exclusions."""

import importlib.util
from pathlib import Path
import zipfile

import pytest

spec = importlib.util.spec_from_file_location("participant_bundle", Path(__file__).parents[1] / "scripts/build_participant_bundle.py")
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


def test_archive_is_reproducible_and_preserves_a_path_with_spaces(tmp_path):
    files = {"README.md": b"Workshop\n", "src/predict/a file.py": b"x = 1\n"}
    first, second = tmp_path / "first.zip", tmp_path / "second.zip"
    bundle.write_archive(first, files, "0" * 64)
    bundle.write_archive(second, files, "0" * 64)
    assert first.read_bytes() == second.read_bytes()
    manifest = bundle.verify_archive(first)
    assert manifest["workshop_version"] == "0.6.0"
    extracted = tmp_path / "Participant Folder With Spaces"
    with zipfile.ZipFile(first) as archive:
        archive.extractall(extracted)
    assert (extracted / bundle.PREFIX / "src/predict/a file.py").read_bytes() == files["src/predict/a file.py"]


def test_modified_zip_content_fails_its_recorded_hash(tmp_path):
    archive_path = tmp_path / "kit.zip"
    bundle.write_archive(archive_path, {"README.md": b"original"}, "0" * 64)
    with zipfile.ZipFile(archive_path) as archive:
        members = {name: archive.read(name) for name in archive.namelist()}
    with zipfile.ZipFile(archive_path, "w") as archive:
        for name, data in members.items():
            archive.writestr(name, b"modified" if name.endswith("README.md") else data)
    with pytest.raises(ValueError, match="checksum"):
        bundle.verify_archive(archive_path)


def test_source_paths_reject_escape_and_symlinks(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    outside = tmp_path / "private.txt"
    outside.write_text("excluded")
    (source / "linked.txt").symlink_to(outside)
    for name in ("../private.txt", "linked.txt", "C:/private.txt", "/private.txt", "folder\\private.txt"):
        with pytest.raises(ValueError, match="Unsafe|unsafe"):
            bundle.snapshot_files(source, (name,))


def test_allowlist_has_current_commands_and_no_hosting_or_submission_identity(tmp_path):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests/test_example.py").write_text("pass")
    names = bundle.repository_files(tmp_path) + bundle.ASSET_FILES + bundle.EMPTY_OUTPUT_FILES
    assert {"src/preprocessing/__main__.py", "src/predict/__main__.py", "src/postprocessing/__main__.py",
            "config/experiments.yaml", "config/evaluation.json", "scripts/prepare_data.py", ".worktreeinclude",
            "data/01_raw/train.parquet", "data/01_raw/validation.parquet",
            "data/01_raw/test.parquet", "src/predict/logistic.py", "src/predict/base.py",
            "tools/results-preview/index.html", "tools/results-preview/app.js",
            "tools/results-preview/style.css", "tools/results-preview/comparison.json",
            "tools/results-preview/leaderboard.json"}.issubset(names)
    assert not any(name.startswith(("site/", "results/", "submissions/", "archive/", "artifacts/", "facilitator/", ".cache/"))
                   or ".openai" in name for name in names)
    output_prefixes = ("data/02_preprocessed/", "data/03_predictions/", "data/04_submissions/", "data/05_analytics/")
    assert set(bundle.EMPTY_OUTPUT_FILES).issubset(names)
    assert all(name.endswith("/.gitkeep") for name in names if name.startswith(output_prefixes))
    assert not any(name.startswith("models/") or "sophon" in name or "xgboost" in name for name in names)
    assert "docs/workshop.md" not in names
    assert len(names) == len(set(names))


def test_bundle_includes_every_core_runtime_module():
    root = Path(__file__).resolve().parents[1]
    optional = {"src/predict/sophon.py", "src/predict/sophon_adapter.py", "src/predict/xgboost.py"}
    sources = {path.relative_to(root).as_posix() for path in (root / "src").rglob("*.py")} - optional
    assert sources.issubset(bundle.repository_files(root))
    assert not optional.intersection(bundle.repository_files(root))


def test_optional_pack_sources_tests_and_weights_never_enter_core_snapshot(tmp_path, monkeypatch):
    (tmp_path / "README.md").write_text("core starter")
    private = ["src/predict/sophon.py", "src/predict/sophon_adapter.py", "src/predict/xgboost.py",
               "config/experiments-sophon.yaml", "config/sophon-contract.json", "config/sophon-model.lock.json",
               "models/pretrained/sophon/model.onnx", "tests/test_sophon.py", "tests/test_xgboost.py",
               "tests/test_optional_pack.py", "optional-model-pack/tests/test_install.py"]
    for name in private:
        path = tmp_path / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("optional content must not ship")
    (tmp_path / "tests/test_core.py").write_text("pass")
    monkeypatch.setattr(bundle, "STATIC_REPOSITORY_FILES", ("README.md",))
    monkeypatch.setattr(bundle, "ASSET_FILES", ())
    files = bundle.participant_files(tmp_path)
    assert set(files) == {"README.md", "tests/test_core.py", *bundle.EMPTY_OUTPUT_FILES}


def test_empty_output_directories_survive_archive_extraction(tmp_path):
    directories = ("data/02_preprocessed", "data/03_predictions", "data/04_submissions", "data/05_analytics")
    files = {f"{directory}/.gitkeep": b"" for directory in directories}
    archive_path = tmp_path / "kit.zip"
    bundle.write_archive(archive_path, files, "0" * 64)
    with zipfile.ZipFile(archive_path) as archive:
        archive.extractall(tmp_path / "extracted")
    root = tmp_path / "extracted" / bundle.PREFIX
    for directory in directories:
        assert sorted(path.name for path in (root / directory).iterdir()) == [".gitkeep"]


def test_participant_snapshot_creates_empty_output_markers_without_reading_generated_data(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    (source / "README.md").write_text("fixture")
    run = source / "data/03_predictions/private-run/result.json"
    run.parent.mkdir(parents=True)
    run.write_text("must not ship")
    for name in ("site/app/page.tsx", "site/.env.local", "site/.openai/hosting.json",
                 "site/node_modules/private-package/index.js", "site/.wrangler/state/private.sqlite"):
        private = source / name
        private.parent.mkdir(parents=True, exist_ok=True)
        private.write_text("must not ship")
    monkeypatch.setattr(bundle, "STATIC_REPOSITORY_FILES", ("README.md",))
    monkeypatch.setattr(bundle, "ASSET_FILES", ())
    files = bundle.participant_files(source)
    assert set(files) == {"README.md", *bundle.EMPTY_OUTPUT_FILES}
    assert all(files[name] == b"" for name in bundle.EMPTY_OUTPUT_FILES)
