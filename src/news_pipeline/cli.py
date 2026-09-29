"""Container-first entry points for data preparation and observable pipeline runs."""

import argparse
import fcntl
import json
import logging
import os
import platform
import subprocess
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from news_pipeline.run_store import checked_run_id, source_fingerprint, state_dir, utc_now, write_json

LOGGER = logging.getLogger(__name__)


@contextmanager
def exclusive_run():
    with (state_dir() / "pipeline.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("Another preparation or pipeline run is active. Wait for it to finish.") from exc
        yield


def launch(args) -> int:
    from news_pipeline.dataset import validate_prepared_dataset

    manifest_path = state_dir() / "data" / args.profile / "manifest.json"
    if not manifest_path.is_file():
        raise ValueError(f"Profile {args.profile!r} is not prepared. Run prepare --profile {args.profile} first.")
    run_id = checked_run_id(args.run_id or (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]))
    run_dir = state_dir() / "runs" / run_id
    with exclusive_run():
        dataset = validate_prepared_dataset(manifest_path.parent, json.loads(manifest_path.read_text()))
        run_dir.mkdir(parents=True, exist_ok=False)
        record_path = run_dir / "run.json"
        record = {"run_id": run_id, "status": "starting", "kind": args.kind,
                  "profile": args.profile, "created_at": utc_now(), "stages": [],
                  "source_fingerprint": source_fingerprint(Path("/workspace")),
                  "source_commit": args.source_commit,
                  "dataset": dataset,
                  "resources": resource_limits()}
        write_json(record_path, record)
        print(f"Run: {run_id}\nSpark UI while running: http://localhost:4040\nHistory: http://localhost:18080", flush=True)
        with (run_dir / "driver.log").open("w", buffering=1) as logfile:
            process = subprocess.Popen([sys.executable, "-m", "news_pipeline.runner", run_id],
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            try:
                assert process.stdout is not None
                for line in process.stdout:
                    logfile.write(line)
                    print(line, end="", flush=True)
                code = process.wait()
            except KeyboardInterrupt:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                code = 130
        record = json.loads(record_path.read_text())
        if code and record["status"] not in ("failed", "succeeded"):
            record.update(status="failed", finished_at=utc_now(),
                          error={"type": "ProcessExit", "message": f"Driver exited with status {code}; see driver.log"})
            write_json(record_path, record)
        print(json.dumps({k: record.get(k) for k in ("run_id", "status", "elapsed_seconds", "history_url")}, indent=2))
        return code


def resource_limits() -> dict:
    result = {"architecture": platform.machine()}
    for key, name in (("memory_max_bytes", "/sys/fs/cgroup/memory.max"), ("cpu_quota", "/sys/fs/cgroup/cpu.max")):
        path = Path(name)
        if path.is_file():
            result[key] = path.read_text().strip()
    return result


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="News readership workshop (run inside Docker).")
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare", help="Download locked news sources and generate reproducible Parquet inputs")
    prep.add_argument("--profile", choices=("smoke", "workshop"), default="workshop")
    prep.add_argument("--seed", type=int, default=42)
    pipeline = commands.add_parser("run", help="Run the baseline and save logs, plans and reports")
    pipeline.add_argument("--profile", choices=("smoke", "workshop"), default="workshop")
    pipeline.add_argument("--run-id")
    pipeline.add_argument("--kind", choices=("workshop", "verification"), default="workshop")
    pipeline.add_argument("--source-commit", default=None, help="Optional host Git commit; source fingerprint is always recorded")
    commands.add_parser("runs", help="List persisted run records as JSON")
    show = commands.add_parser("show", help="Read a run's saved evidence")
    show.add_argument("run_id")
    show.add_argument("--section", choices=("run", "evidence", "quality", "log"), default="run")
    verify = commands.add_parser("verify", help="Compare saved reports with an independent reference")
    verify.add_argument("run_id")
    commands.add_parser("doctor", help="Check runtime versions and resource limits")
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            from news_pipeline.dataset import prepare_dataset
            with exclusive_run():
                manifest = prepare_dataset(state_dir() / "data", state_dir() / "cache", args.profile, args.seed)
            print(json.dumps(manifest, indent=2))
            return 0
        if args.command == "run":
            return launch(args)
        if args.command == "runs":
            print(json.dumps([json.loads(p.read_text()) for p in sorted((state_dir() / "runs").glob("*/run.json"))], indent=2))
        elif args.command == "verify":
            from news_pipeline.dataset import validate_prepared_dataset
            from news_pipeline.verification import verify_reports
            run_dir = state_dir() / "runs" / checked_run_id(args.run_id)
            record = json.loads((run_dir / "run.json").read_text())
            if record["status"] != "succeeded":
                raise ValueError("Only a succeeded pipeline run can be verified.")
            result = {"verified": False, "status": "running", "run_id": record["run_id"],
                      "source_fingerprint": record["source_fingerprint"], "started_at": utc_now()}
            verification_path = run_dir / "verification.json"
            write_json(verification_path, result)
            try:
                profile_dir = state_dir() / "data" / record["profile"]
                validate_prepared_dataset(profile_dir, record["dataset"])
                result.update(verify_reports(profile_dir, run_dir), status="succeeded", verified_at=utc_now())
            except Exception as exc:
                result.update(status="failed", verified_at=utc_now(),
                              error={"type": type(exc).__name__, "message": str(exc)})
                write_json(verification_path, result)
                raise
            write_json(verification_path, result)
            print(json.dumps(result, indent=2))
        elif args.command == "show":
            filename = "driver.log" if args.section == "log" else f"{args.section}.json"
            print((state_dir() / "runs" / checked_run_id(args.run_id) / filename).read_text())
        elif args.command == "doctor":
            import pyspark
            import pyarrow
            print(json.dumps({"spark": pyspark.__version__, "python": platform.python_version(),
                              "pyarrow": pyarrow.__version__, "state_directory": str(state_dir()),
                              "state_writable": os.access(state_dir(), os.W_OK), **resource_limits()}, indent=2))
        return 0
    except Exception as exc:
        LOGGER.error("%s: %s", type(exc).__name__, exc)
        return 1
