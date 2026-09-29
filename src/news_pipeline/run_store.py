"""Durable run records, independent of Spark and suitable for a later monitor."""

import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")
    temporary.replace(path)


def checked_run_id(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", value):
        raise ValueError("Run ID must be 1–80 letters, digits, hyphens or underscores.")
    return value


def state_dir() -> Path:
    return Path(os.environ.get("WORKSHOP_STATE_DIR", "/state"))


def source_fingerprint(root: Path) -> str:
    digest = hashlib.sha256()
    paths = sorted((root / "src").rglob("*.py")) + sorted((root / "config").glob("*"))
    for path in paths:
        if path.is_file():
            digest.update(str(path.relative_to(root)).encode() + b"\0")
            digest.update(path.read_bytes())
    return digest.hexdigest()
