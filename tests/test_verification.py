import json
from datetime import date, datetime, timezone

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from news_pipeline.verification import verify_reports


@pytest.fixture
def outputs(tmp_path):
    profile, run = tmp_path / "profile", tmp_path / "run"
    (profile / "events").mkdir(parents=True)
    report_dir = run / "reports"
    report_dir.mkdir(parents=True)
    pq.write_table(pa.Table.from_pylist([
        {"article_id": "a", "publisher": "News A", "text": "one two three four five six seven eight nine ten"},
        {"article_id": "b", "publisher": "News A", "text": "... 中文"},
        {"article_id": "c", "publisher": "News B", "text": "one two"},
    ]), profile / "articles.parquet")
    first_day = datetime(2026, 1, 15, 12, tzinfo=timezone.utc)
    next_day = datetime(2026, 1, 16, 0, tzinfo=timezone.utc)
    pq.write_table(pa.Table.from_pylist([
        {"event_id": "e1", "article_id": "a", "event_time": first_day, "reading_seconds": 1.5},
        {"event_id": "e2", "article_id": "a", "event_time": first_day, "reading_seconds": 6.0},
        {"event_id": "e3", "article_id": "b", "event_time": first_day, "reading_seconds": 12.0},
        {"event_id": "e4", "article_id": "c", "event_time": first_day, "reading_seconds": 0.25},
        {"event_id": "e5", "article_id": "a", "event_time": next_day, "reading_seconds": 0.75},
    ]), profile / "events" / "part-00000.parquet")
    day, next_date = date(2026, 1, 15), date(2026, 1, 16)
    article_rows = [
        {"event_date": day, "article_id": "a", "publisher": "News A", "read_count": 2, "total_reading_seconds": 7.5, "avg_reading_ratio": 0.75},
        {"event_date": day, "article_id": "b", "publisher": "News A", "read_count": 1, "total_reading_seconds": 12.0, "avg_reading_ratio": 0.0},
        {"event_date": day, "article_id": "c", "publisher": "News B", "read_count": 1, "total_reading_seconds": 0.25, "avg_reading_ratio": 0.25},
        {"event_date": next_date, "article_id": "a", "publisher": "News A", "read_count": 1, "total_reading_seconds": 0.75, "avg_reading_ratio": 0.25},
    ]
    publisher_rows = [
        {"event_date": day, "publisher": "News A", "read_count": 3, "total_reading_seconds": 19.5, "avg_reading_ratio": 0.5},
        {"event_date": day, "publisher": "News B", "read_count": 1, "total_reading_seconds": 0.25, "avg_reading_ratio": 0.25},
        {"event_date": next_date, "publisher": "News A", "read_count": 1, "total_reading_seconds": 0.75, "avg_reading_ratio": 0.25},
    ]
    for name, rows in (("article_report", article_rows), ("publisher_report", publisher_rows)):
        directory = report_dir / name
        directory.mkdir()
        pq.write_table(pa.Table.from_pylist(rows), directory / "part-00000.parquet")
        (directory / "_SUCCESS").touch()
    (run / "quality.json").write_text(json.dumps({
        "read_count": 5, "total_reading_seconds": 20.5, "avg_reading_ratio": 0.4,
        "min_reading_ratio": 0.0, "max_reading_ratio": 1.0,
    }))
    return profile, run


def test_verifies_all_report_groups_and_quality_without_spark(outputs):
    assert verify_reports(*outputs) == {
        "verified": True, "article_count": 3, "read_count": 5,
        "article_groups": 4, "publisher_groups": 3,
    }


@pytest.mark.parametrize("damage", ["missing", "duplicate", "unexpected", "invalid_key", "count", "ratio", "seconds"])
def test_rejects_changed_report_rows(outputs, damage):
    profile, run = outputs
    path = run / "reports" / "article_report" / "part-00000.parquet"
    rows = pq.read_table(path).to_pylist()
    if damage == "missing":
        rows.pop()
    elif damage == "duplicate":
        rows.append(dict(rows[0]))
    elif damage == "unexpected":
        rows[0]["article_id"] = "unknown"
    elif damage == "invalid_key":
        for row in rows:
            row["article_id"] = [row["article_id"]]
    elif damage == "count":
        rows[0]["read_count"] = 3
    elif damage == "ratio":
        rows[0]["avg_reading_ratio"] = 0.7
    else:
        rows[0]["total_reading_seconds"] = 7500.0
    pq.write_table(pa.Table.from_pylist(rows), path)
    with pytest.raises(ValueError, match="article_report"):
        verify_reports(profile, run)


def test_rejects_changed_quality_even_if_reports_are_correct(outputs):
    profile, run = outputs
    path = run / "quality.json"
    quality = json.loads(path.read_text())
    quality["avg_reading_ratio"] = 0.5
    path.write_text(json.dumps(quality))
    with pytest.raises(ValueError, match="quality.json.*avg_reading_ratio"):
        verify_reports(profile, run)


def test_allows_float_reduction_noise_and_changed_row_order(outputs):
    profile, run = outputs
    path = run / "reports" / "publisher_report" / "part-00000.parquet"
    rows = list(reversed(pq.read_table(path).to_pylist()))
    rows[0]["avg_reading_ratio"] += 1e-10
    pq.write_table(pa.Table.from_pylist(rows), path)
    assert verify_reports(profile, run)["verified"]


def test_requires_integer_counts_not_float_counts_in_quality(outputs):
    profile, run = outputs
    path = run / "quality.json"
    quality = json.loads(path.read_text())
    quality["read_count"] = 5.0
    path.write_text(json.dumps(quality))
    with pytest.raises(ValueError, match="quality.json.*read_count"):
        verify_reports(profile, run)
