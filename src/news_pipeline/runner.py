"""Run one Spark application; the CLI captures its Python/JVM output to disk."""

import json
import logging
import platform
import sys
import time
import traceback
from contextlib import contextmanager
from pathlib import Path

from news_pipeline.run_store import checked_run_id, state_dir, utc_now, write_json

LOGGER = logging.getLogger(__name__)


def run(run_id: str) -> int:
    from pyspark.sql import SparkSession
    from news_pipeline.evidence import find_event_log, summarize_event_log
    from news_pipeline.quality import compute_quality
    from news_pipeline.reports import article_report, publisher_report
    from news_pipeline.transforms import build_enriched, load_inputs

    run_dir = state_dir() / "runs" / checked_run_id(run_id)
    record_path = run_dir / "run.json"
    record = json.loads(record_path.read_text())
    started = time.monotonic()
    spark = None
    exit_code = 0

    def save():
        write_json(record_path, record)

    @contextmanager
    def stage(name: str):
        info = {"name": name, "status": "running", "started_at": utc_now()}
        record["stages"].append(info)
        save()
        if spark is not None:
            spark.sparkContext.setJobGroup(f"{run_id}:{name}", name, interruptOnCancel=True)
        mark = time.monotonic()
        LOGGER.info("STAGE START %s", name)
        try:
            yield
            info["status"] = "succeeded"
        except Exception:
            info["status"] = "failed"
            raise
        finally:
            info.update(elapsed_seconds=round(time.monotonic() - mark, 3), finished_at=utc_now())
            save()
            LOGGER.info("STAGE END %s %s %.3fs", name, info["status"], info["elapsed_seconds"])

    try:
        record.update(status="running", started_at=utc_now(), stages=[])
        save()
        with stage("spark_start"):
            spark = (SparkSession.builder.appName(f"news-{record['profile']}-{run_id}")
                     .config("spark.sql.warehouse.dir", str(run_dir / "warehouse"))
                     .getOrCreate())
            spark.sparkContext.setLogLevel("WARN")
            record["spark_application_id"] = spark.sparkContext.applicationId
            record["spark_version"] = spark.version
            record["python_version"] = platform.python_version()
            record["spark_config"] = dict(spark.sparkContext.getConf().getAll())
            record["history_url"] = f"http://localhost:18080/history/{spark.sparkContext.applicationId}/jobs/"
            record["live_ui_url"] = "http://localhost:4040"
        profile_dir = state_dir() / "data" / record["profile"]
        with stage("load_and_validate"):
            articles, events = load_inputs(spark, profile_dir)
            record["input_partitions"] = {"articles": articles.rdd.getNumPartitions(),
                                          "events": events.rdd.getNumPartitions()}
        enriched = build_enriched(articles, events)
        plans_dir = run_dir / "plans"
        plans_dir.mkdir()
        (plans_dir / "enrichment.txt").write_text(enriched._jdf.queryExecution().toString())
        with stage("quality"):
            record["quality"] = compute_quality(enriched)
            expected_count = record["dataset"]["counts"]["events"]
            if record["quality"]["read_count"] != expected_count:
                raise ValueError(f"Expected {expected_count} events; got {record['quality']['read_count']}.")
            write_json(run_dir / "quality.json", record["quality"])
        for label, build_report in (("article_report", article_report), ("publisher_report", publisher_report)):
            with stage(label):
                report = build_report(enriched)
                (plans_dir / f"{label}.txt").write_text(report._jdf.queryExecution().toString())
                report.write.mode("errorifexists").parquet(str(run_dir / "reports" / label))
        record["status"] = "succeeded"
    except Exception as exc:
        exit_code = 1
        record.update(status="failed", error={"type": type(exc).__name__, "message": str(exc)})
        (run_dir / "error.txt").write_text(traceback.format_exc())
        LOGGER.exception("Pipeline failed")
    finally:
        # All comparisons include validation, quality checks, both writes and Spark startup.
        record["workload_elapsed_seconds"] = round(time.monotonic() - started, 3)
        if spark is not None:
            try:
                spark.stop()
            except Exception as exc:
                record.setdefault("warnings", []).append(f"Spark shutdown failed: {exc}")
                record["status"] = "failed"
                exit_code = 1
        record["elapsed_seconds"] = round(time.monotonic() - started, 3)
        record["finished_at"] = utc_now()
        if "spark_application_id" in record:
            try:
                event_log = find_event_log(state_dir() / "spark-events", record["spark_application_id"])
                if event_log is None:
                    raise FileNotFoundError("Spark event log was not found")
                evidence = summarize_event_log(event_log)
                write_json(run_dir / "evidence.json", evidence)
                record["event_log"] = str(event_log)
            except Exception as exc:
                LOGGER.exception("Execution evidence collection failed")
                record.setdefault("warnings", []).append(f"Execution evidence unavailable: {exc}")
        save()
    LOGGER.info("RUN %s %s %.3fs", run_id, record["status"], record["elapsed_seconds"])
    return exit_code


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    raise SystemExit(run(sys.argv[1]))
