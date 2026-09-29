"""Read validated v1 input and enrich reading events with article information."""

import logging
from pathlib import Path

from pyspark.sql import DataFrame, SparkSession, functions as F
from pyspark.sql.types import DoubleType, NumericType, StringType, TimestampType

from news_pipeline.contracts import reading_ratio

LOGGER = logging.getLogger(__name__)
ARTICLE_STRINGS = (
    "article_id", "source_id", "publisher", "text", "created_raw", "url", "author", "license"
)


def _require_columns(frame: DataFrame, columns: tuple[str, ...], name: str) -> None:
    missing = sorted(set(columns) - set(frame.columns))
    if missing:
        raise ValueError(f"{name} is missing required columns: {', '.join(missing)}")


def _require_string_columns(frame: DataFrame, columns: tuple[str, ...], name: str) -> None:
    for column in columns:
        if not isinstance(frame.schema[column].dataType, StringType):
            raise ValueError(f"{name}.{column} must have string type.")


def _missing_string(column: str):
    return F.col(column).isNull() | (F.length(F.trim(F.col(column))) == 0)


def _validate_rows(frame: DataFrame, invalid, name: str) -> int:
    summary = frame.agg(
        F.count("*").alias("rows"),
        F.sum(F.when(invalid, 1).otherwise(0)).alias("invalid_rows"),
    ).first()
    if summary["rows"] == 0:
        raise ValueError(f"{name} must contain at least one row.")
    if summary["invalid_rows"]:
        raise ValueError(f"{name} contains {summary['invalid_rows']} invalid rows.")
    return summary["rows"]


def _validate_unique(frame: DataFrame, column: str, name: str) -> None:
    duplicate = frame.groupBy(column).count().filter(F.col("count") > 1).limit(1).count()
    if duplicate:
        raise ValueError(f"{name}.{column} contains duplicate identifiers.")


def load_inputs(spark: SparkSession, profile_dir: str | Path) -> tuple[DataFrame, DataFrame]:
    """Load a prepared profile and reject unsupported or corrupt input.

    Article metadata may be null. IDs/publisher/text and every event field are
    required; an empty article body is valid. The v1 contract uses seconds.
    """
    profile = Path(profile_dir)
    articles_path, events_path = profile / "articles.parquet", profile / "events"
    for path in (articles_path, events_path):
        if not path.exists():
            raise ValueError(f"Prepared input is missing: {path}. Run prepare first.")

    LOGGER.info("Loading prepared profile: %s", profile)
    articles = spark.read.parquet(str(articles_path))
    events = spark.read.parquet(str(events_path))
    _require_columns(articles, ARTICLE_STRINGS, "articles")
    _require_columns(events, ("event_id", "article_id", "event_time", "reading_seconds"), "events")
    _require_string_columns(articles, ARTICLE_STRINGS, "articles")
    _require_string_columns(events, ("event_id", "article_id"), "events")
    if not isinstance(events.schema["event_time"].dataType, TimestampType):
        raise ValueError("events.event_time must have timestamp type (UTC).")
    if not isinstance(events.schema["reading_seconds"].dataType, NumericType):
        raise ValueError("events.reading_seconds must have numeric type.")
    events = events.withColumn("reading_seconds", F.col("reading_seconds").cast("double"))

    article_count = _validate_rows(
        articles,
        _missing_string("article_id") | _missing_string("source_id")
        | _missing_string("publisher") | F.col("text").isNull(),
        "articles (article_id, source_id, publisher or text)",
    )
    event_count = _validate_rows(
        events,
        _missing_string("event_id") | _missing_string("article_id")
        | F.col("event_time").isNull() | F.col("reading_seconds").isNull()
        | F.isnan("reading_seconds") | (F.abs(F.col("reading_seconds")) == float("inf"))
        | (F.col("reading_seconds") < 0),
        "events (event_id, article_id, event_time or reading_seconds)",
    )
    _validate_unique(articles, "article_id", "articles")
    _validate_unique(events, "event_id", "events")
    if events.join(articles.select("article_id"), "article_id", "left_anti").limit(1).count():
        raise ValueError("events.article_id contains orphan references to missing articles.")
    LOGGER.info("Validated %d articles and %d reading events", article_count, event_count)
    return articles, events


def build_enriched(articles: DataFrame, events: DataFrame) -> DataFrame:
    """Attach article content and calculate each event's reading-time ratio."""
    ratio_udf = F.udf(reading_ratio, DoubleType())
    joined = events.join(articles, on="article_id", how="inner")
    return joined.withColumn("event_date", F.to_date("event_time")).withColumn(
        "reading_ratio", ratio_udf(F.col("text"), F.col("reading_seconds"))
    )
