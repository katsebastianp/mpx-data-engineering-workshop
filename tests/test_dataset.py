"""Dataset integrity and reproducibility tests use local, tiny source fixtures."""

import gzip
import hashlib
import json

import pyarrow.parquet as pq
import pytest

from news_pipeline import dataset


@pytest.fixture
def source_fixture(tmp_path, monkeypatch):
    def row(identity, words=120, source="publisher-one"):
        return {
            "id": identity, "source": source, "text": "news " * words,
            "created": "Published yesterday", "metadata": {
                "url": f"https://example.org/{identity}", "author": "Fixture Author",
                "license": "Fixture licence; not a reuse assertion",
            },
        }
    rows = [row(0), row(1), row(2, source="publisher-two"), row(3, words=8), row(1)]
    compressed = gzip.compress("\n".join(json.dumps(item) for item in rows).encode(), mtime=0)
    digest = hashlib.sha256(compressed).hexdigest()
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / f"{digest}-source.jsonl.gz").write_bytes(compressed)
    lock = {
        "repository": "fixture/news", "revision": "0" * 40,
        "selection": "Test fixture selection", "files": [{
            "path": "source.jsonl.gz", "size_bytes": len(compressed), "sha256": digest,
        }],
    }
    lock_path = tmp_path / "dataset.lock.json"
    lock_path.write_text(json.dumps(lock))
    monkeypatch.setattr(dataset, "DATASET_LOCK_PATH", lock_path)
    monkeypatch.setitem(dataset.PROFILES, "tiny", {"articles": 3, "events": 24})
    return cache


def test_preparation_is_reproducible_and_preserves_attribution(tmp_path, source_fixture):
    first = dataset.prepare_dataset(tmp_path / "first", source_fixture, "tiny")
    second = dataset.prepare_dataset(tmp_path / "second", source_fixture, "tiny")
    assert first == second
    assert first["selection"]["filtered_rows"] == 1
    assert first["selection"]["duplicate_rows"] == 1
    assert first["selected_publishers"] == {"publisher-one": 2, "publisher-two": 1}
    articles = pq.read_table(tmp_path / "first/tiny/articles.parquet").to_pylist()
    assert {row["source_id"] for row in articles} == {"0", "1", "2"}
    assert all(row["created_raw"] == "Published yesterday" for row in articles)
    assert all(row["author"] == "Fixture Author" and row["license"] for row in articles)
    events = pq.read_table(tmp_path / "first/tiny/events").to_pylist()
    assert len(events) == len({row["event_id"] for row in events}) == 24
    assert {row["article_id"] for row in events} <= {row["article_id"] for row in articles}
    assert all(row["event_time"].utcoffset().total_seconds() == 0 for row in events)


def test_existing_dataset_reused_but_different_seed_rejected(tmp_path, source_fixture):
    first = dataset.prepare_dataset(tmp_path / "data", source_fixture, "tiny")
    assert dataset.prepare_dataset(tmp_path / "data", source_fixture, "tiny") == first
    with pytest.raises(ValueError, match="differs in seed"):
        dataset.prepare_dataset(tmp_path / "data", source_fixture, "tiny", seed=43)


def test_existing_modified_data_rejected(tmp_path, source_fixture):
    dataset.prepare_dataset(tmp_path / "data", source_fixture, "tiny")
    (tmp_path / "data/tiny/articles.parquet").write_bytes(b"changed")
    with pytest.raises(ValueError, match="missing or modified"):
        dataset.prepare_dataset(tmp_path / "data", source_fixture, "tiny")


def test_download_failure_never_substitutes_articles(tmp_path, source_fixture, monkeypatch):
    def offline(*args, **kwargs):
        raise OSError("offline fixture")
    monkeypatch.setattr(dataset.urllib.request, "urlopen", offline)
    monkeypatch.setattr(dataset.time, "sleep", lambda seconds: None)
    with pytest.raises(RuntimeError, match="synthetic articles are never substituted"):
        dataset.prepare_dataset(tmp_path / "data", tmp_path / "empty-cache", "tiny")
    assert not (tmp_path / "data/tiny").exists()


def test_changed_download_bytes_rejected(tmp_path, source_fixture, monkeypatch):
    import io
    monkeypatch.setattr(dataset.urllib.request, "urlopen", lambda *args, **kwargs: io.BytesIO(b"wrong"))
    monkeypatch.setattr(dataset.time, "sleep", lambda seconds: None)
    with pytest.raises(RuntimeError, match="verified source"):
        dataset.prepare_dataset(tmp_path / "data", tmp_path / "empty-cache", "tiny")
    assert not list((tmp_path / "empty-cache").glob("*.partial"))
