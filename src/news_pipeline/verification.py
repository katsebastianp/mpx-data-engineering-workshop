"""Independent, non-Spark reference checks for completed workshop reports."""

import json
import logging
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pyarrow.dataset as ds

LOGGER = logging.getLogger(__name__)
REL_TOL = 1e-9
ABS_TOL = 1e-8
MEASURES = ("read_count", "total_reading_seconds", "avg_reading_ratio")


@dataclass
class _Totals:
    count: int = 0
    seconds: float = 0.0
    ratios: float = 0.0
    minimum: float = math.inf
    maximum: float = -math.inf

    def add(self, seconds: float, ratio: float) -> None:
        self.count += 1
        self.seconds += seconds
        self.ratios += ratio
        self.minimum = min(self.minimum, ratio)
        self.maximum = max(self.maximum, ratio)

    def measures(self) -> dict:
        return {
            "read_count": self.count,
            "total_reading_seconds": self.seconds,
            "avg_reading_ratio": self.ratios / self.count,
        }


def _rows(path: Path, columns: tuple[str, ...], *, exact_columns: bool = False):
    try:
        dataset = ds.dataset(path, format="parquet")
        names = dataset.schema.names
        if len(names) != len(set(names)):
            raise ValueError("duplicate column names")
        if not set(columns).issubset(names):
            raise ValueError(f"missing columns: {sorted(set(columns) - set(names))}")
        if exact_columns and set(columns) != set(names):
            raise ValueError(f"unexpected columns: {sorted(set(names) - set(columns))}")
        for batch in dataset.to_batches(columns=list(columns), batch_size=16_384):
            yield from batch.to_pylist()
    except Exception as exc:
        raise ValueError(f"Cannot read verification data at {path}: {exc}") from exc


def _reference(profile_dir: Path) -> tuple[dict, dict, dict, int]:
    articles = {}
    for row in _rows(profile_dir / "articles.parquet", ("article_id", "publisher", "text")):
        article_id, publisher, text = row["article_id"], row["publisher"], row["text"]
        if not isinstance(article_id, str) or not article_id.strip():
            raise ValueError("Reference input has an invalid article_id.")
        if article_id in articles:
            raise ValueError(f"Reference input has duplicate article_id: {article_id}")
        if not isinstance(publisher, str) or not publisher.strip() or not isinstance(text, str):
            raise ValueError(f"Reference input has invalid publisher/text for {article_id}.")
        # Deliberately independent of the production UDF and its constants.
        words = len(re.findall(r"[A-Za-z0-9]+", text))
        duration = max(1.0, words * 60.0 / 200) if words else None
        articles[article_id] = (publisher, duration)
    if not articles:
        raise ValueError("Reference input contains no articles.")

    article_groups, publisher_groups, seen_events = {}, {}, set()
    total = _Totals()
    columns = ("event_id", "article_id", "event_time", "reading_seconds")
    for row in _rows(profile_dir / "events", columns):
        event_id, article_id = row["event_id"], row["article_id"]
        if not isinstance(event_id, str) or not event_id.strip() or event_id in seen_events:
            raise ValueError("Reference input has an invalid or duplicate event_id.")
        seen_events.add(event_id)
        if article_id not in articles:
            raise ValueError(f"Reference input has an unknown article_id: {article_id}")
        timestamp, seconds = row["event_time"], row["reading_seconds"]
        if not isinstance(timestamp, datetime) or timestamp.tzinfo is None:
            raise ValueError("Reference event_time must be a timezone-aware timestamp.")
        if (isinstance(seconds, bool) or not isinstance(seconds, (int, float))
                or not math.isfinite(seconds) or seconds < 0):
            raise ValueError("Reference reading_seconds must be finite and non-negative.")
        day = timestamp.astimezone(timezone.utc).date()
        publisher, duration = articles[article_id]
        ratio = 0.0 if duration is None else min(1.0, seconds / duration)
        article_groups.setdefault((day, article_id, publisher), _Totals()).add(seconds, ratio)
        publisher_groups.setdefault((day, publisher), _Totals()).add(seconds, ratio)
        total.add(seconds, ratio)
    if not total.count:
        raise ValueError("Reference input contains no reading events.")
    quality = {
        **total.measures(),
        "min_reading_ratio": total.minimum,
        "max_reading_ratio": total.maximum,
    }
    return article_groups, publisher_groups, quality, len(articles)


def _compare_measures(actual: dict, expected: dict, label: str) -> None:
    if set(actual) != set(expected):
        raise ValueError(f"{label}: unexpected measure keys {sorted(actual)}.")
    for measure, expected_value in expected.items():
        value = actual[measure]
        if measure == "read_count":
            matches = isinstance(value, int) and not isinstance(value, bool) and value == expected_value
        else:
            matches = (
                not isinstance(value, bool) and isinstance(value, (int, float))
                and math.isfinite(value)
                and math.isclose(value, expected_value, rel_tol=REL_TOL, abs_tol=ABS_TOL)
            )
        if not matches:
            raise ValueError(f"{label}: {measure} is {value!r}; expected {expected_value!r}.")


def _verify_report(path: Path, keys: tuple[str, ...], expected: dict) -> None:
    seen = set()
    for row in _rows(path, (*keys, *MEASURES), exact_columns=True):
        key = tuple(row[name] for name in keys)
        try:
            hash(key)
        except TypeError as exc:
            raise ValueError(f"{path.name}: invalid group key {key!r}.") from exc
        if key in seen:
            raise ValueError(f"{path.name}: duplicate group {key!r}.")
        seen.add(key)
        if key not in expected:
            raise ValueError(f"{path.name}: unexpected group {key!r}.")
        _compare_measures(
            {name: row[name] for name in MEASURES}, expected[key].measures(),
            f"{path.name} {key!r}",
        )
    if seen != set(expected):
        raise ValueError(f"{path.name}: missing {len(set(expected) - seen)} expected groups.")


def verify_reports(profile_dir: Path, run_dir: Path) -> dict:
    """Check every saved group and the quality summary against independent input math.

    Row ordering and Parquet file layout may change. Group keys and counts must
    match exactly; floating measures allow only normal reduction-order error.
    """
    profile_dir, run_dir = Path(profile_dir), Path(run_dir)
    LOGGER.info("Verifying saved reports in %s against %s", run_dir, profile_dir)
    article_groups, publisher_groups, quality, article_count = _reference(profile_dir)
    quality_path = run_dir / "quality.json"
    try:
        saved_quality = json.loads(quality_path.read_text())
    except (OSError, ValueError) as exc:
        raise ValueError(f"Cannot read quality summary at {quality_path}: {exc}") from exc
    if not isinstance(saved_quality, dict):
        raise ValueError("quality.json must contain a JSON object.")
    _compare_measures(saved_quality, quality, "quality.json")
    _verify_report(
        run_dir / "reports" / "article_report", ("event_date", "article_id", "publisher"), article_groups
    )
    _verify_report(
        run_dir / "reports" / "publisher_report", ("event_date", "publisher"), publisher_groups
    )
    result = {
        "verified": True,
        "article_count": article_count,
        "read_count": quality["read_count"],
        "article_groups": len(article_groups),
        "publisher_groups": len(publisher_groups),
    }
    LOGGER.info("Verified %d events across %d article and %d publisher groups",
                result["read_count"], result["article_groups"], result["publisher_groups"])
    return result
