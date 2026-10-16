"""Repeated timing must not hide changed outputs or select a lucky fast run."""

import json
import shutil

import pytest

from scripts import benchmark_preprocessing as runner
from test_compare import comparison_files


def fake_worker(monkeypatch, comparison_files, *, corrupt=False):
    calls = []
    times = {2048: iter([12., 100., 11.]), 4: iter([8., 9., 7.])}

    def run(partitions, output):
        calls.append(partitions)
        shutil.copytree(comparison_files[0], output)
        path = output / "manifest.json"
        value = json.loads(path.read_text())
        value.update(elapsed_seconds=next(times[partitions]),
                     spark={"shuffle_partitions": partitions, "scheduled_tasks": partitions + 4})
        if corrupt and len(calls) == 2:
            value["dataset_id"] = "different"
        path.write_text(json.dumps(value))
        return value

    monkeypatch.setattr(runner, "run_once", run)
    return calls


def test_alternates_order_and_reports_median_not_best_run(monkeypatch, comparison_files, tmp_path):
    calls = fake_worker(monkeypatch, comparison_files)
    output = tmp_path / "benchmark"
    result = runner.benchmark(2048, 4, 3, output)
    assert calls == [2048, 4, 4, 2048, 2048, 4]
    assert result["median_seconds"] == {"before": 12., "after": 8.}
    assert result["time_reduction_percent"] == 33.3
    assert result["equivalent"] is True
    assert json.loads((output / "summary.json").read_text()) == result


def test_changed_data_aborts_without_success_summary(monkeypatch, comparison_files, tmp_path):
    fake_worker(monkeypatch, comparison_files, corrupt=True)
    output = tmp_path / "benchmark"
    with pytest.raises(ValueError):
        runner.benchmark(2048, 4, 3, output)
    assert not (output / "summary.json").exists()


def test_slower_candidate_reports_negative_time_reduction(monkeypatch, comparison_files, tmp_path):
    fake_worker(monkeypatch, comparison_files)
    result = runner.benchmark(4, 2048, 3, tmp_path / "slower")
    assert result["time_reduction_percent"] == -50.0
    assert result["observed_speedup"] < 1


def test_existing_evidence_is_not_overwritten(tmp_path):
    with pytest.raises(FileExistsError):
        runner.benchmark(2048, 4, 3, tmp_path)


@pytest.mark.parametrize("before,after,repeats", [(0, 4, 3), (4, 4, 3), (2048, 4, 1)])
def test_invalid_comparison_is_rejected(tmp_path, before, after, repeats):
    with pytest.raises(ValueError):
        runner.benchmark(before, after, repeats, tmp_path / "new")
