"""Prepare pinned public news and deterministic, explicitly synthetic reading events."""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import random
import re
import shutil
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

LOGGER = logging.getLogger(__name__)
DATASET_LOCK_PATH = Path(__file__).resolve().parents[2] / "config" / "dataset.lock.json"
PROFILES = {
    "smoke": {"articles": 200, "events": 2_000},
    "workshop": {"articles": 10_000, "events": 250_000},
}
FORMAT_VERSION = 1
WORD_PATTERN = re.compile(r"[A-Za-z0-9]+")
ARTICLE_SCHEMA = pa.schema([
    ("article_id", pa.string()),
    ("source_id", pa.string()),
    ("publisher", pa.string()),
    ("text", pa.string()),
    ("created_raw", pa.string()),
    ("url", pa.string()),
    ("author", pa.string()),
    ("license", pa.string()),
])
EVENT_SCHEMA = pa.schema([
    ("event_id", pa.string()),
    ("article_id", pa.string()),
    ("event_time", pa.timestamp("us", tz="UTC")),
    ("reading_seconds", pa.float64()),
])


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _matches_source(path: Path, entry: dict[str, Any]) -> bool:
    return (path.is_file() and path.stat().st_size == entry["size_bytes"]
            and _sha256(path) == entry["sha256"])


def _download_source(lock: dict[str, Any], entry: dict[str, Any], cache_dir: Path) -> Path:
    """Verify cached bytes or download exactly the pinned file, atomically."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    destination = cache_dir / f"{entry['sha256']}-{Path(entry['path']).name}"
    if _matches_source(destination, entry):
        LOGGER.info("Using verified source cache: %s", destination.name)
        return destination
    path = urllib.parse.quote(entry["path"], safe="/")
    url = (f"https://huggingface.co/datasets/{lock['repository']}/resolve/"
           f"{lock['revision']}/{path}?download=true")
    last_error: Exception | None = None
    for attempt in range(3):
        temporary: Path | None = None
        try:
            LOGGER.info("Downloading %s (attempt %d/3)", entry["path"], attempt + 1)
            request = urllib.request.Request(url, headers={"User-Agent": "ringier-data-engineering-workshop/1"})
            with tempfile.NamedTemporaryFile(dir=cache_dir, suffix=".partial", delete=False) as output:
                temporary = Path(output.name)
                with urllib.request.urlopen(request, timeout=60) as response:
                    total = 0
                    while chunk := response.read(1 << 20):
                        total += len(chunk)
                        if total > entry["size_bytes"]:
                            raise ValueError(f"Download exceeds locked size: {entry['path']}")
                        output.write(chunk)
            if not _matches_source(temporary, entry):
                raise ValueError(f"Downloaded size or SHA256 differs from lock: {entry['path']}")
            temporary.replace(destination)
            return destination
        except (OSError, ValueError, urllib.error.URLError) as error:
            last_error = error
            LOGGER.warning("Source download failed: %s", error)
            if attempt < 2:
                time.sleep(2 ** attempt)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    raise RuntimeError(
        f"Could not obtain verified source {entry['path']}. Check Hugging Face access "
        "or prepopulate the verified cache; synthetic articles are never substituted."
    ) from last_error


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _normalise_article(raw: dict[str, Any]) -> dict[str, Any] | None:
    metadata = raw.get("metadata")
    if not isinstance(metadata, dict):
        return None
    source_id = raw.get("id")
    publisher = raw.get("source")
    body = raw.get("text")
    url = metadata.get("url")
    if (source_id is None or not str(source_id).strip()
            or not isinstance(publisher, str) or not publisher.strip()
            or not isinstance(body, str)
            or not isinstance(url, str)):
        return None
    parsed_url = urllib.parse.urlsplit(url)
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        return None
    if len(WORD_PATTERN.findall(body)) < 100:
        return None
    identity = json.dumps([publisher, str(source_id)], ensure_ascii=False, separators=(",", ":"))
    return {
        "article_id": hashlib.sha256(identity.encode()).hexdigest(),
        "source_id": str(source_id),
        "publisher": publisher,
        "text": body,
        "created_raw": _optional_string(raw.get("created")),
        "url": url,
        "author": _optional_string(metadata.get("author")),
        "license": _optional_string(metadata.get("license")),
    }


def _read_articles(paths: list[Path], count: int, seed: int) -> tuple[list[dict[str, Any]], dict[str, int]]:
    articles: dict[str, dict[str, Any]] = {}
    raw_rows = 0
    filtered_rows = 0
    duplicate_rows = 0
    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, 1):
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"Invalid JSON in {path.name}:{line_number}") from error
                if not isinstance(raw, dict):
                    raise ValueError(f"Expected an object in {path.name}:{line_number}")
                raw_rows += 1
                article = _normalise_article(raw)
                if article is None:
                    filtered_rows += 1
                elif article["article_id"] in articles:
                    duplicate_rows += 1
                else:
                    articles[article["article_id"]] = article
    if len(articles) < count:
        raise ValueError(f"Need {count} eligible articles, found {len(articles)}; adjust the pinned sources.")
    # Hash ordering gives a repeatable sample across publishers without depending on input order.
    selected = sorted(articles.values(), key=lambda row: hashlib.sha256(
        f"{seed}:{row['article_id']}".encode()).digest())[:count]
    return selected, {
        "raw_rows": raw_rows, "filtered_rows": filtered_rows,
        "duplicate_rows": duplicate_rows, "eligible_rows": len(articles),
    }


def _write_events(directory: Path, articles: list[dict[str, Any]], count: int, seed: int) -> None:
    directory.mkdir()
    rng = random.Random(seed)
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    estimates = [len(WORD_PATTERN.findall(row["text"])) * 60 / 200 for row in articles]
    cursor = 0
    for partition in range(8):
        end = count * (partition + 1) // 8
        batch: list[dict[str, Any]] = []
        for index in range(cursor, end):
            selected = rng.randrange(len(articles))
            batch.append({
                "event_id": f"synthetic-{seed}-{index:012d}",
                "article_id": articles[selected]["article_id"],
                "event_time": start + timedelta(seconds=rng.randrange(7 * 24 * 3600)),
                "reading_seconds": round(estimates[selected] * rng.uniform(0.05, 1.5), 3),
            })
        pq.write_table(pa.Table.from_pylist(batch, schema=EVENT_SCHEMA),
                       directory / f"part-{partition:05d}.parquet", compression="snappy")
        cursor = end


def _load_existing(directory: Path, expected: dict[str, Any]) -> dict[str, Any]:
    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file():
        raise ValueError(f"Dataset directory exists without a manifest: {directory}. Use a new data directory.")
    manifest = json.loads(manifest_path.read_text())
    for field, value in expected.items():
        if manifest.get(field) != value:
            raise ValueError(f"Existing dataset differs in {field}: {directory}. Use a new data directory.")
    outputs = manifest.get("outputs", {})
    required_paths = {"articles.parquet"} | {f"events/part-{part:05d}.parquet" for part in range(8)}
    if set(outputs) != required_paths:
        raise ValueError(f"Dataset manifest has unexpected files: {directory}")
    for relative_path, digest in outputs.items():
        path = directory / relative_path
        if not path.is_file() or _sha256(path) != digest:
            raise ValueError(f"Prepared dataset missing or modified: {path}. Use a new data directory.")
    LOGGER.info("Reusing verified prepared dataset: %s", directory)
    return manifest


def validate_prepared_dataset(profile_dir: Path, expected_manifest: dict[str, Any]) -> dict[str, Any]:
    """Reject any manifest or data change relative to the captured input snapshot."""
    return _load_existing(profile_dir, expected_manifest)


def prepare_dataset(data_dir: Path, cache_dir: Path, profile: str, seed: int = 42) -> dict[str, Any]:
    """Create data_dir/profile atomically; identical existing inputs are reused, never overwritten."""
    if profile not in PROFILES:
        raise ValueError(f"Unknown profile {profile!r}; choose from {', '.join(PROFILES)}")
    data_dir = Path(data_dir)
    cache_dir = Path(cache_dir)
    lock_bytes = DATASET_LOCK_PATH.read_bytes()
    lock = json.loads(lock_bytes)
    expected = {
        "format_version": FORMAT_VERSION,
        "profile": profile,
        "seed": seed,
        "counts": PROFILES[profile],
        "dataset": {
            "repository": lock["repository"], "revision": lock["revision"],
            "lock_sha256": hashlib.sha256(lock_bytes).hexdigest(),
        },
    }
    destination = data_dir / profile
    if destination.exists():
        return _load_existing(destination, expected)
    sources = [_download_source(lock, entry, cache_dir) for entry in lock["files"]]
    articles, selection = _read_articles(sources, PROFILES[profile]["articles"], seed)
    data_dir.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{profile}-", dir=data_dir))
    try:
        pq.write_table(pa.Table.from_pylist(articles, schema=ARTICLE_SCHEMA),
                       temporary / "articles.parquet", compression="snappy")
        _write_events(temporary / "events", articles, PROFILES[profile]["events"], seed)
        manifest = {
            **expected,
            "events_are_synthetic": True,
            "event_time_zone": "UTC",
            "source_files": lock["files"],
            "selection": {**selection, "rule": lock["selection"]},
            "selected_publishers": dict(sorted(Counter(row["publisher"] for row in articles).items())),
            "outputs": {path.relative_to(temporary).as_posix(): _sha256(path)
                        for path in sorted(temporary.rglob("*.parquet"))},
        }
        (temporary / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        # Atomic rename also refuses to replace another process's nonempty dataset.
        temporary.rename(destination)
        LOGGER.info("Prepared %d articles and %d synthetic events at %s",
                    len(articles), PROFILES[profile]["events"], destination)
        return manifest
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
