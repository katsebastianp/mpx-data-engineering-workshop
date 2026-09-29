"""Small Spark integration cases: stable business outputs and rejected input."""

from datetime import date, datetime, timezone
from pathlib import Path

import pytest

pyspark = pytest.importorskip("pyspark")
from pyspark.sql import SparkSession
from pyspark.sql.types import (
    DoubleType, StringType, StructField, StructType, TimestampType,
)

from news_pipeline.quality import compute_quality
from news_pipeline.reports import article_report, publisher_report
from news_pipeline.transforms import build_enriched, load_inputs

pytestmark = pytest.mark.integration

ARTICLE_SCHEMA = StructType([
    StructField(name, StringType(), True)
    for name in ("article_id", "source_id", "publisher", "text", "created_raw", "url", "author", "license")
])
EVENT_SCHEMA = StructType([
    StructField("event_id", StringType(), True),
    StructField("article_id", StringType(), True),
    StructField("event_time", TimestampType(), True),
    StructField("reading_seconds", DoubleType(), True),
])
ARTICLES = [
    ("a", "source-a", "News A", "one two three four five six seven eight nine ten", None, "https://example.org/a", None, "CC-BY-4.0"),
    ("b", "source-b", "News A", "", None, "https://example.org/b", None, "CC-BY-4.0"),
]
EVENT_TIME = datetime(2026, 1, 15, 12, 0, tzinfo=timezone.utc)
EVENTS = [
    ("e1", "a", EVENT_TIME, 1.5),
    ("e2", "a", EVENT_TIME, 6.0),
    ("e3", "b", EVENT_TIME, 12.0),
]


@pytest.fixture(scope="module")
def spark(tmp_path_factory):
    session = (
        SparkSession.builder.master("local[2]")
        .appName("news-pipeline-contract-tests")
        .config("spark.ui.enabled", "false")
        .config("spark.eventLog.enabled", "false")
        .config("spark.sql.shuffle.partitions", "2")
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.warehouse.dir", str(tmp_path_factory.mktemp("warehouse")))
        .getOrCreate()
    )
    session.sparkContext.setLogLevel("ERROR")
    yield session
    session.stop()


def write_profile(spark, path: Path, articles=ARTICLES, events=EVENTS, event_schema=EVENT_SCHEMA):
    spark.createDataFrame(articles, ARTICLE_SCHEMA).write.mode("overwrite").parquet(str(path / "articles.parquet"))
    spark.createDataFrame(events, event_schema).write.mode("overwrite").parquet(str(path / "events"))


def test_reports_match_independent_expected_values_and_preserve_totals(spark, tmp_path):
    write_profile(spark, tmp_path)
    articles, events = load_inputs(spark, tmp_path)
    enriched = build_enriched(articles, events)
    quality = compute_quality(enriched)
    assert quality == pytest.approx({
        "read_count": 3, "total_reading_seconds": 19.5,
        "avg_reading_ratio": 0.5, "min_reading_ratio": 0.0, "max_reading_ratio": 1.0,
    })
    article_rows = {row.article_id: row.asDict() for row in article_report(enriched).collect()}
    assert set(article_rows) == {"a", "b"}
    assert article_rows["a"] == {
        "event_date": date(2026, 1, 15), "article_id": "a", "publisher": "News A",
        "read_count": 2, "total_reading_seconds": 7.5, "avg_reading_ratio": 0.75,
    }
    assert article_rows["b"]["read_count"] == 1
    assert article_rows["b"]["avg_reading_ratio"] == 0.0
    assert publisher_report(enriched).first().asDict() == {
        "event_date": date(2026, 1, 15), "publisher": "News A", "read_count": 3,
        "total_reading_seconds": 19.5, "avg_reading_ratio": 0.5,
    }


@pytest.mark.parametrize("duration", [-1.0, None, float("nan"), float("inf")])
def test_input_rejects_invalid_reading_durations(spark, tmp_path, duration):
    write_profile(spark, tmp_path, events=[("e1", "a", EVENT_TIME, duration)])
    with pytest.raises(ValueError, match="reading_seconds.*invalid rows"):
        load_inputs(spark, tmp_path)


@pytest.mark.parametrize("kind", ["duplicate_article", "duplicate_event", "orphan"])
def test_input_rejects_records_that_would_change_report_totals(spark, tmp_path, kind):
    articles, events = list(ARTICLES), list(EVENTS)
    if kind == "duplicate_article":
        articles.append(ARTICLES[0])
    elif kind == "duplicate_event":
        events.append(EVENTS[0])
    else:
        events.append(("e4", "absent", EVENT_TIME, 1.0))
    write_profile(spark, tmp_path, articles, events)
    with pytest.raises(ValueError, match="duplicate|orphan"):
        load_inputs(spark, tmp_path)


def test_input_reports_missing_seconds_column(spark, tmp_path):
    millisecond_schema = StructType([
        *EVENT_SCHEMA.fields[:3], StructField("reading_ms", DoubleType(), True)
    ])
    write_profile(spark, tmp_path, event_schema=millisecond_schema)
    with pytest.raises(ValueError, match="missing required columns: reading_seconds"):
        load_inputs(spark, tmp_path)


def test_input_rejects_null_article_text(spark, tmp_path):
    article = list(ARTICLES[0])
    article[3] = None
    write_profile(spark, tmp_path, articles=[tuple(article)], events=EVENTS[:1])
    with pytest.raises(ValueError, match="text.*invalid rows"):
        load_inputs(spark, tmp_path)
