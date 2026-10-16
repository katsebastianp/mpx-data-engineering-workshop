"""Verify the four raw sample downloads for the logistic starter.

Run: docker compose run --rm --no-deps setup
Participant instructions and sample downloads live on the workshop Site.
Optional reference models are installed separately; setup never downloads models.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOGGER = logging.getLogger(__name__)
SAMPLE_FILES = {"manifest.json", "train.parquet", "validation.parquet", "test.parquet"}
SITE = "https://ringier-collision-lab.openai.chatgpt.site/workshop?step=download-data"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file(path: Path, expected_hash: str, size: int | None = None) -> None:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Missing regular file: {path}.")
    if (size is not None and path.stat().st_size != size) or sha256(path) != expected_hash:
        raise ValueError(f"Checksum or size mismatch: {path}.")


def verify_sample(directory: Path, sample_lock_path: Path = ROOT / "config/workshop-sample.lock.json") -> dict:
    """Pin every received byte independently of the downloaded manifest."""
    release = json.loads(sample_lock_path.read_text())
    if release.get("version") != 1 or set(release.get("files", {})) != SAMPLE_FILES:
        raise ValueError("The workshop sample lock is not the supported four-file release.")
    problems = []
    for name, expected in release["files"].items():
        try:
            verify_file(directory / name, expected["sha256"], expected["size_bytes"])
        except ValueError as error:
            problems.append(str(error))
    if problems:
        raise ValueError("\n".join(problems) + f"\nDownload the named files from {SITE} and save them in {directory}. "
                         "Keep the exact filenames; replace an incorrect download yourself, then rerun setup.")
    manifest = json.loads((directory / "manifest.json").read_text())
    identity = hashlib.sha256(json.dumps(
        {split: release["files"][f"{split}.parquet"]["sha256"] for split in ("test", "train", "validation")},
        sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if manifest.get("dataset_id") != release.get("dataset_id") or identity != release["dataset_id"]:
        raise ValueError("The sample dataset identity differs from the pinned workshop release.")
    return manifest


def setup(raw_dir: Path) -> dict:
    """Validate the pinned sample and its contents without loading or fetching a model."""
    from scripts.prepare_data import validate_bundle as validate_raw_bundle

    manifest = verify_sample(raw_dir)
    data_lock_path = ROOT / "config/workshop-data.lock.json"
    validate_raw_bundle(raw_dir, json.loads(data_lock_path.read_text()), sha256(data_lock_path))
    LOGGER.info("Verified all 6,000 raw jets: 4,000 train / 1,000 validation / 1,000 test")
    return {"dataset_id": manifest["dataset_id"],
            "rows": sum(split["rows"] for split in manifest["splits"].values()), "status": "ready"}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "data/01_raw")
    # Compatibility with older participant commands; setup now always checks data only.
    parser.add_argument("--skip-sophon", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        print(json.dumps(setup(args.raw_dir), indent=2))
        return 0
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        LOGGER.error("Workshop setup failed: %s", error)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
