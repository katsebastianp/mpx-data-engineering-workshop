"""Read uncompressed, non-rolling Spark 3.5 event logs without a Spark runtime.

Metrics include all observed task attempts, including failed/retried attempts.
Executor CPU time is JVM CPU time, not Python worker CPU time. A Python operator
in a SQL plan is evidence of the plan's structure, not a measurement of UDF time.
Event schemas: Apache Spark v3.5.7 JsonProtocol.scala and SQLListener.scala.
"""

from __future__ import annotations

import json
import logging
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterator

LOGGER = logging.getLogger(__name__)
_PYTHON_OPERATOR = re.compile(r"\b(?:BatchEvalPython|ArrowEvalPython|PythonUDF)\b")
_METRICS = {
    "executor_run_time_ms": ("Executor Run Time",),
    "executor_cpu_time_ns": ("Executor CPU Time",),
    "jvm_gc_time_ms": ("JVM GC Time",),
    "memory_bytes_spilled": ("Memory Bytes Spilled",),
    "disk_bytes_spilled": ("Disk Bytes Spilled",),
    "input_bytes": ("Input Metrics", "Bytes Read"),
    "input_records": ("Input Metrics", "Records Read"),
    "output_bytes": ("Output Metrics", "Bytes Written"),
    "output_records": ("Output Metrics", "Records Written"),
    "shuffle_local_bytes_read": ("Shuffle Read Metrics", "Local Bytes Read"),
    "shuffle_remote_bytes_read": ("Shuffle Read Metrics", "Remote Bytes Read"),
    "shuffle_records_read": ("Shuffle Read Metrics", "Total Records Read"),
    "shuffle_bytes_written": ("Shuffle Write Metrics", "Shuffle Bytes Written"),
    "shuffle_records_written": ("Shuffle Write Metrics", "Shuffle Records Written"),
}


def find_event_log(event_log_dir: Path, app_id: str) -> Path | None:
    """Find this local application's exact v1 log, preferring its completed file.

    Compressed and rolling logs are intentionally unsupported. No prefix search:
    a different application's evidence must never be substituted for this run.
    """
    if not app_id or Path(app_id).name != app_id or app_id in {".", ".."}:
        raise ValueError("Expected a plain Spark application ID")
    if event_log_dir.exists() and not event_log_dir.is_dir():
        raise NotADirectoryError(event_log_dir)
    for name in (app_id, f"{app_id}.inprogress"):
        candidate = event_log_dir / name
        if candidate.is_file():
            return candidate
    return None


def _events(path: Path, warnings: list[str]) -> Iterator[dict[str, Any]]:
    # One-line lookahead distinguishes a partial tail from corruption in the log.
    with path.open("rb") as handle:
        line = handle.readline()
        line_number = 0
        while line:
            following = handle.readline()
            line_number += 1
            if line.strip():
                try:
                    event = json.loads(line.decode("utf-8"))
                except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                    if not following and not line.endswith(b"\n"):
                        warning = f"Ignored incomplete final JSON record at line {line_number}"
                        warnings.append(warning)
                        LOGGER.warning("%s: %s", path, warning)
                        return
                    raise ValueError(f"Invalid event JSON in {path}, line {line_number}") from exc
                if not isinstance(event, dict) or not isinstance(event.get("Event"), str):
                    raise ValueError(f"Invalid Spark event in {path}, line {line_number}")
                yield event
            line = following


def _duration(start: Any, end: Any) -> int | None:
    return end - start if isinstance(start, int) and isinstance(end, int) else None


def _peak_overlap(deltas: Counter[int]) -> int:
    """Peak of half-open [launch, finish) intervals; equal-time ends free slots."""
    active = peak = 0
    for timestamp in sorted(deltas):
        active += deltas[timestamp]
        peak = max(peak, active)
    return peak


def _stage(stage_id: int, attempt: int) -> dict[str, Any]:
    return {
        "stage_id": stage_id, "attempt_id": attempt, "name": None,
        "number_of_tasks": None, "submitted_at_ms": None, "completed_at_ms": None,
        "failure_reason": None, "tasks_started": 0, "task_attempts_ended": 0,
        "tasks_succeeded": 0, "tasks_failed_or_killed": 0,
        "tasks_with_metrics": 0, "submission_observed": False,
        "task_lifetimes_measured": 0, "zero_ms_task_lifetimes": 0,
        "task_duration_ms": None,
        "metrics": {name: None for name in _METRICS},
        "metric_task_counts": {name: 0 for name in _METRICS},
    }


def _merge_stage_info(stage: dict[str, Any], info: dict[str, Any]) -> None:
    for output, source in (
        ("name", "Stage Name"), ("number_of_tasks", "Number of Tasks"),
        ("submitted_at_ms", "Submission Time"), ("completed_at_ms", "Completion Time"),
        ("failure_reason", "Failure Reason"),
    ):
        if source in info:
            stage[output] = info[source]


def _collect_metrics(stage: dict[str, Any], metrics: dict[str, Any]) -> None:
    stage["tasks_with_metrics"] += 1
    for name, keys in _METRICS.items():
        value: Any = metrics
        for key in keys:
            value = value.get(key) if isinstance(value, dict) else None
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            stage["metrics"][name] = (stage["metrics"][name] or 0) + value
            stage["metric_task_counts"][name] += 1


def summarize_event_log(path: Path) -> dict[str, Any]:
    """Stream a Spark log into JSON-serializable execution evidence.

    Missing measurements are null, not zero. Invalid complete records and I/O
    errors raise; an unfinished final JSON line is skipped with an explicit
    warning. Jobs may reference shared stages: do not sum metrics per job.
    """
    warnings: list[str] = []
    jobs: dict[int, dict[str, Any]] = {}
    stages: dict[tuple[int, int], dict[str, Any]] = {}
    executions: dict[int, dict[str, Any]] = {}
    active: dict[int, tuple[int, int]] = {}
    lifetime_deltas: Counter[int] = Counter()
    stage_lifetime_deltas: dict[tuple[int, int], Counter[int]] = {}
    ended_tasks: set[int] = set()
    counts: Counter[str] = Counter()
    spark_version = None
    application: dict[str, Any] = {
        "id": None, "name": None, "started_at_ms": None,
        "ended_at_ms": None, "completed": False,
    }
    spark_properties: dict[str, str] = {}

    def get_stage(stage_id: int, attempt: int = 0) -> dict[str, Any]:
        return stages.setdefault((stage_id, attempt), _stage(stage_id, attempt))

    def get_execution(execution_id: int) -> dict[str, Any]:
        return executions.setdefault(execution_id, {
            "execution_id": execution_id, "description": None,
            "started_at_ms": None, "ended_at_ms": None,
            "initial_plan": None, "latest_plan": None,
            "adaptive_plan_updates": 0, "python_operators": [], "error_message": None,
        })

    for event in _events(path, warnings):
        kind = event["Event"]
        counts[kind] += 1
        if kind == "SparkListenerLogStart":
            spark_version = event.get("Spark Version")
        elif kind == "SparkListenerApplicationStart":
            application.update(id=event.get("App ID"), name=event.get("App Name"),
                               started_at_ms=event.get("Timestamp"))
        elif kind == "SparkListenerApplicationEnd":
            application.update(ended_at_ms=event.get("Timestamp"), completed=True)
        elif kind == "SparkListenerEnvironmentUpdate":
            # Keep only relevant configuration; do not persist environment credentials.
            properties = event.get("Spark Properties", {})
            for key in ("spark.master", "spark.driver.memory", "spark.sql.shuffle.partitions",
                        "spark.sql.adaptive.enabled",
                        "spark.sql.adaptive.coalescePartitions.enabled"):
                if key in properties:
                    spark_properties[key] = properties[key]
        elif kind == "SparkListenerJobStart":
            properties = event.get("Properties") or {}
            execution_id = properties.get("spark.sql.execution.id")
            jobs[event["Job ID"]] = {
                "job_id": event["Job ID"], "job_group": properties.get("spark.jobGroup.id"),
                "description": properties.get("spark.job.description"),
                "sql_execution_id": int(execution_id) if execution_id is not None else None,
                "stage_ids": event.get("Stage IDs", []),
                "submitted_at_ms": event.get("Submission Time"),
                "completed_at_ms": None, "result": None,
            }
            for info in event.get("Stage Infos", []):
                _merge_stage_info(get_stage(info["Stage ID"], info.get("Stage Attempt ID", 0)), info)
        elif kind == "SparkListenerJobEnd":
            job_id = event["Job ID"]
            if job_id not in jobs:
                warnings.append(f"Job {job_id} ended without a recorded start")
            else:
                jobs[job_id].update(completed_at_ms=event.get("Completion Time"),
                                    result=event.get("Job Result"))
        elif kind in {"SparkListenerStageSubmitted", "SparkListenerStageCompleted"}:
            info = event["Stage Info"]
            stage = get_stage(info["Stage ID"], info.get("Stage Attempt ID", 0))
            _merge_stage_info(stage, info)
            if kind == "SparkListenerStageSubmitted":
                stage["submission_observed"] = True
        elif kind in {"SparkListenerTaskStart", "SparkListenerTaskEnd"}:
            key = (event["Stage ID"], event.get("Stage Attempt ID", 0))
            stage = get_stage(*key)
            info = event["Task Info"]
            task_id = info["Task ID"]
            if kind == "SparkListenerTaskStart":
                if task_id in active or task_id in ended_tasks:
                    warnings.append(f"Duplicate start for task {task_id}")
                    continue
                active[task_id] = key
                stage["tasks_started"] += 1
            else:
                if task_id in ended_tasks:
                    warnings.append(f"Duplicate end for task {task_id}; metrics counted once")
                    continue
                ended_tasks.add(task_id)
                active_key = active.pop(task_id, None)
                if active_key is None:
                    warnings.append(f"Task {task_id} ended without a recorded start")
                stage["task_attempts_ended"] += 1
                reason = (event.get("Task End Reason") or {}).get("Reason")
                if reason == "Success":
                    stage["tasks_succeeded"] += 1
                elif reason is not None:
                    stage["tasks_failed_or_killed"] += 1
                duration = _duration(info.get("Launch Time"), info.get("Finish Time"))
                if duration is not None:
                    if duration < 0:
                        warnings.append(f"Task {task_id} has a finish timestamp before its launch")
                    else:
                        stage["task_duration_ms"] = (stage["task_duration_ms"] or 0) + duration
                        stage["task_lifetimes_measured"] += 1
                        if duration == 0:
                            stage["zero_ms_task_lifetimes"] += 1
                        # Scheduler lifetimes include result handling and may overlap
                        # beyond the executor's real number of running task slots.
                        deltas = stage_lifetime_deltas.setdefault(key, Counter())
                        for counter in (deltas, lifetime_deltas):
                            counter[info["Launch Time"]] += 1
                            counter[info["Finish Time"]] -= 1
                if isinstance(event.get("Task Metrics"), dict):
                    _collect_metrics(stage, event["Task Metrics"])
        elif kind.endswith(("SparkListenerSQLExecutionStart", "SparkListenerSQLExecutionEnd",
                            "SparkListenerSQLAdaptiveExecutionUpdate")):
            execution = get_execution(event["executionId"])
            if kind.endswith("SparkListenerSQLExecutionStart"):
                execution.update(description=event.get("description"),
                                 started_at_ms=event.get("time"),
                                 initial_plan=event.get("physicalPlanDescription"))
            elif kind.endswith("SparkListenerSQLExecutionEnd"):
                execution.update(ended_at_ms=event.get("time"), error_message=event.get("errorMessage"))
            else:
                execution["adaptive_plan_updates"] += 1
            if "physicalPlanDescription" in event:
                plan = event["physicalPlanDescription"]
                execution["latest_plan"] = plan
                execution["python_operators"] = sorted(
                    set(execution["python_operators"]) | set(_PYTHON_OPERATOR.findall(plan)))

    for job in jobs.values():
        job["duration_ms"] = _duration(job["submitted_at_ms"], job["completed_at_ms"])
    for stage in stages.values():
        stage["execution_observed"] = bool(stage["submission_observed"] or stage["tasks_started"]
                                           or stage["task_attempts_ended"])
        stage["peak_overlapping_task_lifetimes"] = (
            _peak_overlap(stage_lifetime_deltas[(stage["stage_id"], stage["attempt_id"])])
            if stage["task_lifetimes_measured"] else None)
        related = [job for job in jobs.values() if stage["stage_id"] in job["stage_ids"]]
        stage["job_ids"] = sorted(job["job_id"] for job in related)
        stage["job_groups"] = sorted({job["job_group"] for job in related if job["job_group"]})
        stage["sql_execution_ids"] = sorted({job["sql_execution_id"] for job in related
                                              if job["sql_execution_id"] is not None})
        stage["duration_ms"] = _duration(stage["submitted_at_ms"], stage["completed_at_ms"])
        local = stage["metrics"]["shuffle_local_bytes_read"]
        remote = stage["metrics"]["shuffle_remote_bytes_read"]
        stage["metrics"]["shuffle_bytes_read"] = local + remote if local is not None and remote is not None else None
    for execution in executions.values():
        related = [job for job in jobs.values() if job["sql_execution_id"] == execution["execution_id"]]
        execution["job_ids"] = sorted(job["job_id"] for job in related)
        execution["job_groups"] = sorted({job["job_group"] for job in related if job["job_group"]})
        execution["stage_ids"] = sorted({stage_id for job in related for stage_id in job["stage_ids"]})
        execution["duration_ms"] = _duration(execution["started_at_ms"], execution["ended_at_ms"])
        execution["plan_contains_python"] = bool(execution["python_operators"])
    application["duration_ms"] = _duration(application["started_at_ms"], application["ended_at_ms"])
    if not counts:
        warnings.append("No complete Spark events observed")
    return {
        "schema_version": 1, "event_log": str(path), "spark_version": spark_version,
        "application": application, "spark_properties": spark_properties,
        "event_count": sum(counts.values()), "event_type_counts": dict(counts),
        "warnings": warnings, "in_progress": not application["completed"],
        "job_count": len(jobs), "stage_attempt_count": len(stages),
        "executed_stage_attempt_count": sum(stage["execution_observed"] for stage in stages.values()),
        "task_attempts_ended": len(ended_tasks), "tasks_still_active": len(active),
        "peak_overlapping_task_lifetimes": (
            _peak_overlap(lifetime_deltas)
            if any(stage["task_lifetimes_measured"] for stage in stages.values()) else None),
        "jobs": [jobs[key] for key in sorted(jobs)],
        "stages": [stages[key] for key in sorted(stages)],
        "sql_executions": [executions[key] for key in sorted(executions)],
        "metric_notes": [
            "Task sums include failed and retried attempts; missing measurements are null.",
            "Executor CPU time measures JVM work, not Python worker CPU time.",
            "Python operators indicate plan structure, not measured UDF time or execution count.",
            "Jobs can reference shared stages; do not sum stage metrics once per referencing job.",
            "number_of_tasks is the planned count; execution_observed and task_attempts_ended show actual execution.",
            "Task lifetime overlap uses completed tasks' launch/finish timestamps, including result handling; it is not CPU or executor-slot concurrency.",
            "Zero-millisecond task lifetimes contribute no overlap at the event log's timestamp resolution.",
        ],
    }
