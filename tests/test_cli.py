import hashlib
import json

from news_pipeline.cli import main


def test_run_rejects_changed_input_before_starting_driver(tmp_path, monkeypatch):
    monkeypatch.setenv("WORKSHOP_STATE_DIR", str(tmp_path))
    profile = tmp_path / "data" / "smoke"
    (profile / "events").mkdir(parents=True)
    outputs = {}
    for name in ["articles.parquet"] + [f"events/part-{i:05d}.parquet" for i in range(8)]:
        (profile / name).write_bytes(b"snapshot")
        outputs[name] = hashlib.sha256(b"snapshot").hexdigest()
    (profile / "manifest.json").write_text(json.dumps({"profile": "smoke", "outputs": outputs}))
    (profile / "articles.parquet").write_bytes(b"changed")
    assert main(["run", "--profile", "smoke", "--run-id", "changed-input"]) == 1
    assert not (tmp_path / "runs" / "changed-input").exists()


def test_failed_reverification_replaces_previous_success(tmp_path, monkeypatch):
    monkeypatch.setenv("WORKSHOP_STATE_DIR", str(tmp_path))
    run_dir = tmp_path / "runs" / "prior-success"
    run_dir.mkdir(parents=True)
    record = {"run_id": "prior-success", "status": "succeeded", "profile": "smoke",
              "source_fingerprint": "source", "dataset": {"snapshot": "original"}}
    (run_dir / "run.json").write_text(json.dumps(record))
    result_path = run_dir / "verification.json"
    result_path.write_text(json.dumps({"verified": True}))
    # A removed/changed input snapshot must invalidate the earlier success.
    assert main(["verify", "prior-success"]) == 1
    result = json.loads(result_path.read_text())
    assert result["verified"] is False
    assert result["status"] == "failed"
    assert result["error"]["message"]
