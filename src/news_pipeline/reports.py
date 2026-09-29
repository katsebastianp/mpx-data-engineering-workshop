"""Daily readership report definitions."""

from pyspark.sql import DataFrame, functions as F


def _aggregate(enriched: DataFrame, *keys: str) -> DataFrame:
    return enriched.groupBy(*keys).agg(
        F.count("*").alias("read_count"),
        F.sum("reading_seconds").alias("total_reading_seconds"),
        F.avg("reading_ratio").alias("avg_reading_ratio"),
    )


def article_report(enriched: DataFrame) -> DataFrame:
    return _aggregate(enriched, "event_date", "article_id", "publisher")


def publisher_report(enriched: DataFrame) -> DataFrame:
    return _aggregate(enriched, "event_date", "publisher")
