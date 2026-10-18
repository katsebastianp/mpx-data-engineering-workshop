"""Serial inference timing, CPU reference workload and hardware metadata."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from predict.base import Predictor
    from workshop_types import Record, Rows

import hashlib
import importlib.metadata
import math
import os
from pathlib import Path
import platform
import statistics
import time

import numpy as np
from threadpoolctl import threadpool_limits

BENCHMARK_ROWS = 128
REFERENCE_ITERATIONS = 64
LATENCY_PROTOCOL = "jetclass2-cpu-128-v1"


def reference_seconds() -> float:
    """A fixed numeric CPU workload, an approximate hardware correction only."""
    rng = np.random.default_rng(42)
    left, right = rng.standard_normal((256, 256)), rng.standard_normal((256, 256))
    elapsed = []
    with threadpool_limits(limits=1):
        for repeat in range(4):
            start = time.perf_counter()
            for _ in range(REFERENCE_ITERATIONS):
                product = left @ right
            seconds = time.perf_counter() - start
            if not np.isfinite(product).all():
                raise ValueError("Reference CPU workload produced nonfinite values.")
            if repeat:
                elapsed.append(seconds)
    return statistics.median(elapsed)


def benchmark_model(model: Predictor, validation: Rows) -> tuple[dict[str, float], Record]:
    rows = sorted(validation, key=lambda row: row["record_id"])[:BENCHMARK_ROWS]
    if len(rows) != BENCHMARK_ROWS:
        raise ValueError(f"Latency comparisons require exactly {BENCHMARK_ROWS} fixed validation jets.")
    expected = model.predict(rows)
    elapsed = []
    for _ in range(3):
        start = time.perf_counter()
        actual = model.predict(rows)
        elapsed.append(time.perf_counter() - start)
        if not np.allclose(actual, expected, rtol=1e-4, atol=1e-5) or not np.array_equal(actual >= .5, expected >= .5):
            raise ValueError("Repeated inference changed scores or threshold decisions.")
    inference, reference = statistics.median(elapsed), reference_seconds()
    if not math.isfinite(inference) or inference <= 0 or not math.isfinite(reference) or reference <= 0:
        raise ValueError("Invalid latency measurement.")
    identity = hashlib.sha256(("\n".join(row["record_id"] for row in rows) + "\n").encode()).hexdigest()
    protocol = {"id": LATENCY_PROTOCOL, "benchmark_rows": BENCHMARK_ROWS, "reference_iterations": REFERENCE_ITERATIONS,
        "warmups": 1, "repeats": 3, "threads": 1, "validation_ids_sha256": identity,
        "batch_strategy": "one jet per ONNX call" if model.metadata["kind"] == "sophon" else "one batch of 128 jets",
        "includes_feature_matrix_or_tensor_conversion": True, "includes_model_loading": False,
        "reference_kernel": "64 float64 256x256 matrix products; seed 42; one BLAS thread; median of 3 after 1 warmup",
        "interpretation": "Self-reported local CPU timing. The fixed numeric reference is an approximate hardware correction, not an equivalent model workload."}
    return {"inference_seconds": inference, "per_jet_ms": inference * 1000 / BENCHMARK_ROWS,
            "reference_seconds": reference, "relative_speed": reference / inference,
            "benchmark_rows": BENCHMARK_ROWS, "rows": BENCHMARK_ROWS, "repeat_count": 3}, protocol


def hardware_info() -> Record:
    result: Record = {"platform": platform.platform(), "architecture": platform.machine(), "python": platform.python_version(),
              "cpu_count": os.cpu_count(), "cpu_description": platform.processor(), "threads_per_model": 1}
    for key, filename in (("cpu_quota", "cpu.max"), ("memory_limit", "memory.max")):
        path = Path("/sys/fs/cgroup") / filename
        if path.is_file():
            result[key] = path.read_text().strip()
    peak = Path("/sys/fs/cgroup/memory.peak")
    events = Path("/sys/fs/cgroup/memory.events")
    if peak.is_file():
        result["memory_peak_bytes"] = int(peak.read_text().strip())
    if events.is_file():
        result["memory_events"] = {name: int(value) for name, value in
                                   (line.split() for line in events.read_text().splitlines())}
    result["dependencies"] = {name: importlib.metadata.version(name) for name in ("numpy", "scikit-learn", "xgboost", "onnxruntime")}
    return result

