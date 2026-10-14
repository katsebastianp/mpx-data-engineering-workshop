"""Stage the four pinned sample files for the authenticated workshop Site.

Run from the repository root: python3 scripts/stage_site_sample.py
The generated site/public/downloads/ files are excluded from the GitHub repo.
"""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import shutil
import sys
import tempfile

if __package__:
    from .setup_workshop import SAMPLE_FILES, verify_sample
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from setup_workshop import SAMPLE_FILES, verify_sample

ROOT = Path(__file__).resolve().parents[1]
LOGGER = logging.getLogger(__name__)


def stage_sample(source: Path, output: Path, lock: Path) -> dict:
    """Verify a complete snapshot before replacing any published sample file."""
    if output.is_symlink() or (output.exists() and not output.is_dir()):
        raise ValueError(f"The Site sample destination must be a regular directory: {output}")
    if output.exists():
        for path in output.iterdir():
            if path.name not in SAMPLE_FILES or path.is_symlink() or not path.is_file():
                raise ValueError(f"Unexpected file in the Site sample destination: {path}")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".sample-stage-", dir=output.parent) as temporary:
        staged = Path(temporary) / "sample"
        staged.mkdir()
        for name in sorted(SAMPLE_FILES):
            path = source / name
            if path.is_symlink() or not path.is_file():
                raise ValueError(f"Missing regular sample file: {path}")
            shutil.copyfile(path, staged / name)
        manifest = verify_sample(staged, lock)
        total_bytes = sum(path.stat().st_size for path in staged.iterdir())
        if output.exists():
            for name in sorted(SAMPLE_FILES):
                (staged / name).replace(output / name)
        else:
            staged.replace(output)
    LOGGER.info("Staged four verified sample files (%s bytes) in %s", total_bytes, output)
    return {"dataset_id": manifest["dataset_id"], "files": sorted(SAMPLE_FILES),
            "size_bytes": total_bytes, "output": str(output), "verified": True}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "data/01_raw")
    parser.add_argument("--output", type=Path, default=ROOT / "site/public/downloads/jetclass2-v1")
    parser.add_argument("--lock", type=Path, default=ROOT / "config/workshop-sample.lock.json")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        print(json.dumps(stage_sample(args.source, args.output, args.lock), indent=2))
        return 0
    except (OSError, ValueError, KeyError) as error:
        LOGGER.error("Sample staging failed: %s", error)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
