"""Pre-publication checks and summary statistics."""

import logging

from pyspark.sql import DataFrame, functions as F

LOGGER = logging.getLogger(__name__)


def compute_quality(enriched: DataFrame) -> dict:
    """Evaluate ratio coverage and bounds before publishing readership reports."""
    LOGGER.info("Checking reading-time ratios")
    row = enriched.agg(
        F.count("*").alias("read_count"),
        F.count("reading_ratio").alias("ratio_count"),
        F.sum("reading_seconds").alias("total_reading_seconds"),
        F.avg("reading_ratio").alias("avg_reading_ratio"),
        F.min("reading_ratio").alias("min_reading_ratio"),
        F.max("reading_ratio").alias("max_reading_ratio"),
    ).first()
    values = row.asDict()
    if not values["read_count"]:
        raise ValueError("Quality check failed: no reading events after enrichment.")
    if values.pop("ratio_count") != values["read_count"]:
        raise ValueError("Quality check failed: missing reading-time ratios.")
    if not 0 <= values["min_reading_ratio"] <= values["max_reading_ratio"] <= 1:
        raise ValueError("Quality check failed: reading-time ratios must lie in [0, 1].")
    LOGGER.info("Quality check passed for %d reading events", values["read_count"])
    return values
