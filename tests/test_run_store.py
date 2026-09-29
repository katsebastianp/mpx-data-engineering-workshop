from pathlib import Path

import pytest

from news_pipeline.run_store import checked_run_id, source_fingerprint, write_json


@pytest.mark.parametrize("value", ["../another-run", "/absolute", "", "x/y", "x" * 81])
def test_run_id_cannot_escape_its_artifact_directory(value):
    with pytest.raises(ValueError):
        checked_run_id(value)


def test_fingerprint_tracks_source_and_config_but_not_bytecode(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "config").mkdir()
    source = tmp_path / "src" / "transform.py"
    source.write_text("pass\n")
    before = source_fingerprint(tmp_path)
    (tmp_path / "src" / "ignored.pyc").write_bytes(b"cache")
    assert source_fingerprint(tmp_path) == before
    (tmp_path / "config" / "spark-defaults.conf").write_text("spark.sql.shuffle.partitions 16\n")
    assert source_fingerprint(tmp_path) != before


def test_atomic_json_never_persists_nonfinite_metrics(tmp_path):
    target = tmp_path / "run.json"
    write_json(target, {"status": "running"})
    with pytest.raises(ValueError):
        write_json(target, {"elapsed": float("nan")})
    assert '"running"' in target.read_text()
