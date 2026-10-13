"""Repository paths and atomic file helpers shared by the three pipeline stages."""

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"
RAW_DIR = ROOT / "data/01_raw"
PREPROCESSED_DIR = ROOT / "data/02_preprocessed"
PREDICTIONS_DIR = ROOT / "data/03_predictions"
SUBMISSIONS_DIR = ROOT / "data/04_submissions"
ANALYTICS_DIR = ROOT / "data/05_analytics"
MODELS_DIR = ROOT / "models"
SOPHON_DIR = MODELS_DIR / "pretrained/sophon"


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                         dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
