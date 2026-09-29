import json
from pathlib import Path

import pytest

from news_pipeline.evidence import find_event_log, summarize_event_log


def write_log(path: Path, events: list[dict], tail: str = "") -> Path:
    path.write_text("".join(json.dumps(event) + "\n" for event in events) + tail, encoding="utf-8")
    return path


def task(event: str, task_id: int, stage_id: int = 3, **extra) -> dict:
    return {"Event": event, "Stage ID": stage_id, "Stage Attempt ID": 0,
            "Task Info": {"Task ID": task_id, "Launch Time": 100, "Finish Time": 140}, **extra}


def test_links_evidence_and_measures_actual_tasks(tmp_path):
    stage_info = {"Stage ID": 3, "Stage Attempt ID": 0, "Stage Name": "aggregate",
                  "Number of Tasks": 1000, "Submission Time": 90}
    prefix = "org.apache.spark.sql.execution.ui."
    events = [
        {"Event": "SparkListenerLogStart", "Spark Version": "3.5.7"},
        {"Event": "SparkListenerApplicationStart", "App ID": "local-123", "App Name": "news", "Timestamp": 1},
        {"Event": "SparkListenerEnvironmentUpdate", "Spark Properties": {
            "spark.master": "local[2]", "spark.sql.shuffle.partitions": "1000", "secret": "omit"}},
        {"Event": prefix + "SparkListenerSQLExecutionStart", "executionId": 7,
         "description": "quality check", "time": 50,
         "physicalPlanDescription": "HashAggregate\n+- BatchEvalPython [reading_ratio(text, reading_seconds)]"},
        {"Event": "SparkListenerJobStart", "Job ID": 2, "Submission Time": 80,
         "Stage IDs": [3], "Stage Infos": [stage_info], "Properties": {
             "spark.jobGroup.id": "quality", "spark.job.description": "Check reading ratio",
             "spark.sql.execution.id": "7"}},
        {"Event": "SparkListenerStageSubmitted", "Stage Info": stage_info},
        task("SparkListenerTaskStart", 1),
        task("SparkListenerTaskStart", 2),
        task("SparkListenerTaskEnd", 1, **{"Task End Reason": {"Reason": "Success"}, "Task Metrics": {
            "Executor Run Time": 35, "Executor CPU Time": 1500,
            "Input Metrics": {"Bytes Read": 500, "Records Read": 5},
            "Shuffle Read Metrics": {"Local Bytes Read": 100, "Remote Bytes Read": 10},
            "Shuffle Write Metrics": {"Shuffle Bytes Written": 70}}}),
        task("SparkListenerTaskEnd", 2, **{"Task End Reason": {"Reason": "Success"}, "Task Metrics": {
            "Executor Run Time": 30, "Executor CPU Time": 1300,
            "Input Metrics": {"Bytes Read": 400, "Records Read": 4},
            "Shuffle Read Metrics": {"Local Bytes Read": 50, "Remote Bytes Read": 0},
            "Shuffle Write Metrics": {"Shuffle Bytes Written": 30}}}),
        {"Event": "SparkListenerStageCompleted", "Stage Info": {**stage_info, "Completion Time": 150}},
        {"Event": "SparkListenerJobEnd", "Job ID": 2, "Completion Time": 160, "Job Result": {"Result": "JobSucceeded"}},
        {"Event": prefix + "SparkListenerSQLExecutionEnd", "executionId": 7, "time": 170, "errorMessage": ""},
        {"Event": "SparkListenerApplicationEnd", "Timestamp": 200},
    ]
    summary = summarize_event_log(write_log(tmp_path / "local-123", events))
    assert summary["application"]["duration_ms"] == 199
    assert summary["in_progress"] is False
    assert summary["peak_overlapping_task_lifetimes"] == 2
    assert summary["tasks_still_active"] == 0
    assert summary["spark_properties"] == {"spark.master": "local[2]", "spark.sql.shuffle.partitions": "1000"}
    assert summary["jobs"][0]["duration_ms"] == 80
    stage = summary["stages"][0]
    assert stage["number_of_tasks"] == 1000  # Planned, not falsely reported as completed.
    assert stage["task_attempts_ended"] == 2
    assert stage["job_groups"] == ["quality"]
    assert stage["sql_execution_ids"] == [7]
    assert stage["metrics"]["input_bytes"] == 900
    assert stage["metrics"]["shuffle_bytes_read"] == 160
    assert stage["metrics"]["shuffle_bytes_written"] == 100
    assert stage["metrics"]["executor_run_time_ms"] == 65
    assert stage["metrics"]["jvm_gc_time_ms"] is None
    assert stage["metric_task_counts"]["input_bytes"] == 2
    execution = summary["sql_executions"][0]
    assert execution["plan_contains_python"] is True
    assert execution["python_operators"] == ["BatchEvalPython"]
    assert execution["job_groups"] == ["quality"]
    assert execution["stage_ids"] == [3]


def test_partial_tail_is_reported_but_corrupt_complete_records_fail(tmp_path):
    event = {"Event": "SparkListenerLogStart", "Spark Version": "3.5.7"}
    path = write_log(tmp_path / "local-1.inprogress", [event], '{"Event": "SparkListenerTask')
    summary = summarize_event_log(path)
    assert summary["event_count"] == 1
    assert summary["in_progress"] is True
    assert "line 2" in summary["warnings"][0]
    path.write_text('{broken}\n' + json.dumps(event) + "\n")
    with pytest.raises(ValueError, match="line 1"):
        summarize_event_log(path)
    path.write_bytes((json.dumps(event) + "\n").encode() + b'{"Event":"unfinished \xe2\x82')
    assert "line 2" in summarize_event_log(path)["warnings"][0]
    path.write_text('{broken}\n')
    with pytest.raises(ValueError, match="line 1"):
        summarize_event_log(path)


def test_empty_log_is_explicit(tmp_path):
    path = tmp_path / "empty.inprogress"
    path.touch()
    summary = summarize_event_log(path)
    assert summary["event_count"] == 0
    assert summary["application"]["completed"] is False
    assert summary["warnings"] == ["No complete Spark events observed"]


def test_missing_task_metrics_are_null_and_retries_have_separate_stages(tmp_path):
    events = [
        task("SparkListenerTaskStart", 1),
        task("SparkListenerTaskEnd", 1, **{"Task End Reason": {"Reason": "ExceptionFailure"}}),
        task("SparkListenerTaskStart", 2, **{"Stage Attempt ID": 1}),
        task("SparkListenerTaskEnd", 2, **{"Stage Attempt ID": 1, "Task End Reason": {"Reason": "Success"}}),
    ]
    result = summarize_event_log(write_log(tmp_path / "log", events))
    assert result["stage_attempt_count"] == 2
    # Fixture timestamps overlap despite sequential event records.
    assert result["peak_overlapping_task_lifetimes"] == 2
    assert result["stages"][0]["tasks_failed_or_killed"] == 1
    assert result["stages"][1]["tasks_succeeded"] == 1
    assert result["stages"][0]["metrics"]["executor_run_time_ms"] is None
    assert result["stages"][0]["tasks_with_metrics"] == 0


def test_adaptive_plans_and_duplicate_task_end(tmp_path):
    prefix = "org.apache.spark.sql.execution.ui."
    ended = task("SparkListenerTaskEnd", 1, **{"Task End Reason": {"Reason": "Success"},
                                               "Task Metrics": {"Executor Run Time": 10}})
    events = [
        {"Event": prefix + "SparkListenerSQLExecutionStart", "executionId": 1,
         "description": "report", "time": 0, "physicalPlanDescription": "AdaptiveSparkPlan"},
        {"Event": prefix + "SparkListenerSQLAdaptiveExecutionUpdate", "executionId": 1,
         "physicalPlanDescription": "BatchEvalPython"},
        task("SparkListenerTaskStart", 1), ended, ended,
    ]
    result = summarize_event_log(write_log(tmp_path / "log", events))
    assert result["sql_executions"][0]["adaptive_plan_updates"] == 1
    assert result["sql_executions"][0]["plan_contains_python"] is True
    assert result["task_attempts_ended"] == 1
    assert result["stages"][0]["metrics"]["executor_run_time_ms"] == 10
    assert "Duplicate end" in result["warnings"][0]


def test_lifetime_overlap_uses_timestamps_not_listener_order(tmp_path):
    events = []
    # Starts can be recorded before an earlier task's end reaches the listener.
    for task_id in (1, 2, 3):
        events.append(task("SparkListenerTaskStart", task_id))
    for task_id, start, end in ((1, 0, 10), (2, 10, 20), (3, 20, 20)):
        events.append(task("SparkListenerTaskEnd", task_id, **{
            "Task Info": {"Task ID": task_id, "Launch Time": start, "Finish Time": end},
            "Task End Reason": {"Reason": "Success"},
        }))
    result = summarize_event_log(write_log(tmp_path / "log", events))
    assert result["peak_overlapping_task_lifetimes"] == 1
    assert result["stages"][0]["peak_overlapping_task_lifetimes"] == 1
    assert result["stages"][0]["zero_ms_task_lifetimes"] == 1
    assert result["task_attempts_ended"] == 3
    assert "observed_max_concurrent_tasks" not in result


def test_referenced_stage_is_not_counted_as_executed(tmp_path):
    events = [{"Event": "SparkListenerJobStart", "Job ID": 1, "Stage IDs": [1, 3],
               "Stage Infos": [{"Stage ID": 1, "Number of Tasks": 1000},
                               {"Stage ID": 3, "Number of Tasks": 2}]}]
    events.extend([task("SparkListenerTaskStart", 1), task("SparkListenerTaskEnd", 1)])
    result = summarize_event_log(write_log(tmp_path / "log", events))
    assert result["stage_attempt_count"] == 2
    assert result["executed_stage_attempt_count"] == 1
    assert result["stages"][0]["number_of_tasks"] == 1000
    assert result["stages"][0]["execution_observed"] is False
    assert result["stages"][0]["peak_overlapping_task_lifetimes"] is None
    assert result["stages"][1]["execution_observed"] is True


def test_exact_log_lookup_and_io_errors(tmp_path):
    assert find_event_log(tmp_path, "local-123") is None
    other = tmp_path / "local-1234"
    other.touch()
    assert find_event_log(tmp_path, "local-123") is None
    running = tmp_path / "local-123.inprogress"
    running.touch()
    assert find_event_log(tmp_path, "local-123") == running
    completed = tmp_path / "local-123"
    completed.touch()
    assert find_event_log(tmp_path, "local-123") == completed
    with pytest.raises(ValueError):
        find_event_log(tmp_path, "../local-123")
    with pytest.raises(FileNotFoundError):
        summarize_event_log(tmp_path / "missing")
