"""Verify the Site's raw sample; optionally fetch the pinned public Sophon bundle.

Core workshop: docker compose run --rm --no-deps setup scripts/setup_workshop.py --skip-sophon
Optional Sophon reference: docker compose run --rm --no-deps setup
Participant instructions and the four sample downloads live on the workshop Site.
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import logging
import os
from pathlib import Path
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOGGER = logging.getLogger(__name__)
SAMPLE_FILES = {"manifest.json", "train.parquet", "validation.parquet", "test.parquet"}
SITE = "https://ringier-collision-lab.openai.chatgpt.site/workshop?step=project"


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


def publish_new_file(temporary: Path, target: Path, expected_hash: str, size: int | None = None) -> None:
    """Install a complete file atomically, without replacing an existing file."""
    # Docker runs as root; host Codex must be able to copy these public assets
    # into worktrees on Linux and WSL as well as macOS.
    temporary.chmod(0o644)
    try:
        os.link(temporary, target)
    except FileExistsError:
        verify_file(target, expected_hash, size)


def download_file(url: str, target: Path, expected_hash: str, size: int | None = None) -> None:
    if target.exists() or target.is_symlink():
        try:
            verify_file(target, expected_hash, size)
        except ValueError as error:
            raise ValueError(f"{error} Move or remove that file, then rerun setup; it was not overwritten.") from error
        LOGGER.info("Reusing verified %s", target.name)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    limit = size if size is not None else 16 * 1024 * 1024
    for attempt in range(3):
        temporary = None
        try:
            LOGGER.info("Downloading %s (attempt %d/3)", target.name, attempt + 1)
            request = urllib.request.Request(url, headers={"User-Agent": "ringier-workshop/0.6", "Accept-Encoding": "identity"})
            with urllib.request.urlopen(request, timeout=120) as response:
                if response.status != 200:
                    raise ValueError(f"Unexpected HTTP status {response.status}.")
                with tempfile.NamedTemporaryFile(dir=target.parent, suffix=".partial", delete=False) as stream:
                    temporary = Path(stream.name)
                    received = 0
                    while True:
                        chunk = response.read(min(1 << 20, limit - received + 1))
                        if not chunk:
                            break
                        received += len(chunk)
                        if received > limit:
                            raise ValueError("Download exceeded its expected size limit.")
                        stream.write(chunk)
            verify_file(temporary, expected_hash, size)
            publish_new_file(temporary, target, expected_hash, size)
            LOGGER.info("Verified %s", target.name)
            return
        except (OSError, ValueError, http.client.HTTPException) as error:
            LOGGER.warning("Download failed for %s: %s", target.name, error)
            if attempt == 2:
                host = urllib.parse.urlsplit(url).hostname
                raise RuntimeError(f"Could not download verified {target.name} from {host}. "
                                   "Check internet access and rerun the setup service. No Hugging Face account or token is required.") from error
            time.sleep(2 ** attempt)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


def setup_sophon(directory: Path) -> dict:
    from predict.sophon import validate_bundle as validate_sophon_bundle

    lock_path = ROOT / "config/sophon-model.lock.json"
    contract = json.loads((ROOT / "config/sophon-contract.json").read_text())
    verify_file(lock_path, contract["model_lock_sha256"])
    verify_file(ROOT / "src/predict/sophon_adapter.py", contract["adapter_sha256"])
    lock = json.loads(lock_path.read_text())
    model, upstream = lock["model"], lock["upstream"]
    artifacts = [(directory / "model.onnx", model["sha256"], model["size_bytes"],
                  f"https://huggingface.co/{model['repository']}/resolve/{model['revision']}/{model['path']}?download=true")]
    artifacts.extend((directory / Path(name).name, expected, None,
                      f"https://raw.githubusercontent.com/{upstream['repository']}/{upstream['revision']}/{name}")
                     for name, expected in upstream["files"].items())
    metadata = directory / "model.lock.json"
    try:
        conflicting_metadata = metadata.is_symlink() or (metadata.exists() and (not metadata.is_file() or json.loads(metadata.read_text()) != lock))
    except (ValueError, UnicodeError):
        conflicting_metadata = True
    if conflicting_metadata:
        raise ValueError(f"Conflicting Sophon metadata: {metadata}. Move or remove it, then rerun setup; it was not overwritten.")
    # Check all existing artifacts before making any network request.
    for target, expected, size, _ in artifacts:
        if target.exists() or target.is_symlink():
            try:
                verify_file(target, expected, size)
            except ValueError as error:
                raise ValueError(f"{error} Move or remove that file, then rerun setup; it was not overwritten.") from error
    for target, expected, size, url in artifacts:
        download_file(url, target, expected, size)
    if not metadata.exists():
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, suffix=".partial", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(lock_path.read_bytes())
            publish_new_file(temporary, metadata, sha256(lock_path))
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return validate_sophon_bundle(directory)


def setup(raw_dir: Path, model_dir: Path, *, skip_sophon: bool = False) -> dict:
    from scripts.prepare_data import validate_bundle as validate_raw_bundle

    manifest = verify_sample(raw_dir)
    data_lock_path = ROOT / "config/workshop-data.lock.json"
    validate_raw_bundle(raw_dir, json.loads(data_lock_path.read_text()), sha256(data_lock_path))
    LOGGER.info("Verified all 6,000 raw jets: 4,000 train / 1,000 validation / 1,000 test")
    model = None
    if skip_sophon:
        LOGGER.info("Sophon explicitly skipped. The logistic baseline is ready; optional Sophon assets were not checked. "
                    "To enable that reference later, rerun setup without --skip-sophon.")
    else:
        model = setup_sophon(model_dir)
    return {"dataset_id": manifest["dataset_id"], "rows": sum(split["rows"] for split in manifest["splits"].values()),
            "sophon_sha256": model["model"]["sha256"] if model else None,
            "sophon_status": "skipped" if skip_sophon else "verified", "status": "ready"}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=ROOT / "data/01_raw")
    parser.add_argument("--model-dir", type=Path, default=ROOT / "models/pretrained/sophon")
    parser.add_argument("--skip-sophon", action="store_true",
                        help="Verify the fixed data only. Skip downloading/checking the optional frozen model.")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        print(json.dumps(setup(args.raw_dir, args.model_dir, skip_sophon=args.skip_sophon), indent=2))
        return 0
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        LOGGER.error("Workshop setup failed: %s", error)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
