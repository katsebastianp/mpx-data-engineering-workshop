"""Build a legacy offline v0.6 archive from an explicit list of local files.

Run: docker compose run --rm lab scripts/build_participant_bundle.py
The current participant flow uses Site downloads and Python setup, not this ZIP.
The archive contains the logistic starter, teaching subsets and the offline results viewer.
Optional classifier implementations and model weights, the hosted Site source, Docker
images, historical runs and hosting identity do not ship.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
from pathlib import Path, PurePosixPath
import stat
import tempfile
import zipfile

LOGGER = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
PREFIX = "ringier-particle-workshop/"
MANIFEST = "PARTICIPANT_BUNDLE.json"
STATIC_REPOSITORY_FILES = (
    ".dockerignore", ".gitattributes", ".gitignore", ".worktreeinclude", "README.md", "AGENTS.md", "Dockerfile",
    "compose.yaml", "pyproject.toml", "requirements.txt", "config/experiments.yaml",
    "src/common.py", "src/preprocessing/__init__.py", "src/preprocessing/__main__.py",
    "src/preprocessing/pipeline.py", "src/preprocessing/features.py",
    "src/predict/__init__.py", "src/predict/__main__.py", "src/predict/experiment.py",
    "src/predict/base.py", "src/predict/logistic.py", "src/predict/metrics.py",
    "src/predict/config.py", "src/predict/data.py", "src/predict/benchmark.py",
    "src/predict/models.py",
    "src/postprocessing/__init__.py", "src/postprocessing/__main__.py",
    "src/postprocessing/compare.py", "src/postprocessing/explorer.py", "src/postprocessing/database.py", "src/postprocessing/leaderboard.py",
    "config/workshop-data.lock.json", "config/workshop-sample.lock.json",
    "docs/model-outputs.md", "docs/assets/jet-examples.json",
    "scripts/build_participant_bundle.py", "scripts/prepare_data.py", "scripts/setup_workshop.py",
    "scripts/stage_site_sample.py", "scripts/compare_preprocessing.py", "scripts/benchmark_preprocessing.py",
    "config/evaluation.json",
    "tools/model-explorer/index.html", "tools/model-explorer/app.js", "tools/model-explorer/style.css",
    "tools/model-explorer/comparison.json", "tools/model-explorer/leaderboard.json",
)
EMPTY_OUTPUT_FILES = (
    "data/02_preprocessed/.gitkeep", "data/03_predictions/.gitkeep",
    "data/04_submissions/.gitkeep", "data/05_analytics/.gitkeep",
)
ASSET_FILES = tuple(f"data/01_raw/{name}" for name in ("manifest.json", "train.parquet", "validation.parquet", "test.parquet"))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_name(name: str) -> bool:
    path = PurePosixPath(name)
    return (bool(name) and not path.is_absolute() and ".." not in path.parts and "\\" not in name
            and ":" not in name and path.as_posix() == name)


def repository_files(root: Path) -> tuple[str, ...]:
    """Include core tests, without inheriting optional model packs or hosting contents."""
    return STATIC_REPOSITORY_FILES + tuple(path.relative_to(root).as_posix()
        for path in sorted((root / "tests").glob("test_*.py"))
        if not path.name.startswith(("test_sophon", "test_xgboost", "test_optional_")))


def validate_assets(files: dict[str, bytes]) -> str:
    """Catch mixed data releases before producing a distributable starter archive."""
    raw = json.loads(files["data/01_raw/manifest.json"])
    if set(raw["splits"]) != {"train", "validation", "test"}:
        raise ValueError("Participant data requires the three disjoint official splits")
    if raw["data_lock_sha256"] != digest(files["config/workshop-data.lock.json"]):
        raise ValueError("Participant data source lock changed")
    for split, entry in raw["splits"].items():
        if entry["file"] != f"{split}.parquet" or digest(files[f"data/01_raw/{split}.parquet"]) != entry["sha256"]:
            raise ValueError(f"Participant {split} data checksum changed")
    identity = digest(json.dumps({name: raw["splits"][name]["sha256"] for name in sorted(raw["splits"])},
                                 sort_keys=True, separators=(",", ":")).encode())
    if identity != raw["dataset_id"]:
        raise ValueError("Participant dataset identity differs from its split hashes")
    for name in ("config/evaluation.json", "tools/model-explorer/comparison.json", "tools/model-explorer/leaderboard.json"):
        value = json.loads(files[name])
        if value["dataset_id"] != raw["dataset_id"]:
            raise ValueError(f"Different dataset in portable competition asset: {name}")
        if name.startswith("tools/model-explorer/") and any(row.get("team") != "example-team" for row in value["experiments"]):
            raise ValueError("The portable demo board may contain only clearly labeled example-team results")
    return raw["dataset_id"]


def snapshot_files(root: Path, names: tuple[str, ...]) -> dict[str, bytes]:
    """Read only explicitly permitted regular files, preserving their bytes."""
    if len(set(names)) != len(names):
        raise ValueError("Duplicate file in participant bundle allowlist")
    root = root.resolve()
    files = {}
    for name in sorted(names):
        if not safe_name(name):
            raise ValueError(f"Unsafe bundle path: {name}")
        path = root / name
        if not path.resolve().is_relative_to(root) or path.is_symlink() or not path.is_file():
            raise ValueError(f"Missing, non-file or unsafe bundle input: {name}")
        files[name] = path.read_bytes()
    return files


def participant_files(root: Path) -> dict[str, bytes]:
    """Read released inputs only; create clean output folders without reading runs."""
    files = snapshot_files(root, repository_files(root) + ASSET_FILES)
    for name in EMPTY_OUTPUT_FILES:
        files[name] = b""
    return files


def verify_archive(path: Path) -> dict:
    """Check every ZIP member against the included per-file SHA256 manifest."""
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate ZIP member")
        if any(stat.S_IFMT(info.external_attr >> 16) not in (0, stat.S_IFREG) for info in archive.infolist()):
            raise ValueError("Participant ZIP members must be regular files")
        manifest = json.loads(archive.read(PREFIX + MANIFEST))
        files = manifest["files"]
        if any(not safe_name(name) for name in files):
            raise ValueError("Unsafe path in bundle manifest")
        expected = {PREFIX + name for name in files} | {PREFIX + MANIFEST}
        if set(names) != expected:
            raise ValueError("ZIP members do not match the manifest")
        for name, metadata in files.items():
            data = archive.read(PREFIX + name)
            if len(data) != metadata["size_bytes"] or digest(data) != metadata["sha256"]:
                raise ValueError(f"Bundle checksum mismatch: {name}")
    return manifest


def write_archive(output: Path, files: dict[str, bytes], dataset_id: str) -> dict:
    """Publish only after ZIP integrity and manifest verification succeed."""
    manifest = {
        "bundle_version": 2, "workshop_version": "0.6.0", "dataset_id": dataset_id,
        "contents": "Logistic starter and extensible preprocessing/predict/postprocessing modules, core scripts/tests/docs, 4,000 train + 1,000 validation + 1,000 test jets, canonical competition reference and offline results viewer in tools/model-explorer/.",
        "demo_data": "The offline results viewer contains example-team results only. Participant result folders and actual submission files are excluded.",
        "excluded": ["optional classifier implementations and model weights", "optional reference model packs", "hosted Site source", "Site dependencies and database state", "Docker images", "Git history", "source shard caches", "historical archives", "participant results", "submission files", "secrets", "hosting identity"],
        "files": {name: {"size_bytes": len(data), "sha256": digest(data)} for name, data in sorted(files.items())},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".participant-bundle-", suffix=".zip", delete=False) as stream:
            temporary = Path(stream.name)
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, data in sorted(files.items()):
                write_member(archive, name, data)
            write_member(archive, MANIFEST, (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode())
        verified = verify_archive(temporary)
        temporary.replace(output)
        output.chmod(0o644)
        archive_sha256 = digest(output.read_bytes())
        output.with_suffix(output.suffix + ".sha256").write_text(f"{archive_sha256}  {output.name}\n", encoding="utf-8")
        return {"output": str(output), "size_bytes": output.stat().st_size,
                "sha256": archive_sha256, "files": len(verified["files"]),
                "dataset_id": dataset_id, "verified": True}
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_member(archive: zipfile.ZipFile, name: str, data: bytes) -> None:
    # Fixed ZIP timestamp gives reproducible bytes; 0644 permits Docker's
    # non-root UID to read files after extraction by a different host user.
    info = zipfile.ZipInfo(PREFIX + name, date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, data)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist/ringier-particle-workshop.zip")
    parser.add_argument("--verify", type=Path, help="Verify an existing bundle instead of creating it")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        if args.verify:
            result = verify_archive(args.verify)
            print(json.dumps({"verified": True, "files": len(result["files"]),
                              "dataset_id": result["dataset_id"]}, indent=2))
        else:
            files = participant_files(ROOT)
            result = write_archive(args.output, files, validate_assets(files))
            LOGGER.info("Verified %s files in %s", result["files"], args.output)
            print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as exc:
        LOGGER.error("Participant bundle failed: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
