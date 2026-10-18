"""Prepare the frozen, disjoint participant data bundle (facilitator only).

Run: docker compose run --rm lab scripts/prepare_data.py
To deliberately repin sources, use --discover-lock in a network-enabled facilitator container.
Only selected column chunks from six official shards are downloaded. Participants
receive data/01_raw; they do not need this source download or a Hugging Face key.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from workshop_types import Record

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import logging
import math
from pathlib import Path
import shutil
import struct
import tempfile
import time
from typing import Any
import urllib.parse
import urllib.request

import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "config/workshop-data.lock.json"
LOGGER = logging.getLogger(__name__)
REPOSITORY = "jet-universe/jetclass2"
REVISION = "0701417bfdb1659e2206e958e07870ab74cc2283"
SEED = 42
SPLIT_ROWS = {"train": 4000, "validation": 1000, "test": 1000}
SPLIT_FILES = {
    "train": ("data/Res2P_0000.parquet", "data/QCD_0000.parquet"),
    "validation": ("data/Res2P_0200.parquet", "data/QCD_0280.parquet"),
    "test": ("data/Res2P_0251.parquet", "data/QCD_0351.parquet"),
}
ARRAY_COLUMNS = (
    "part_px", "part_py", "part_pz", "part_energy", "part_deta", "part_dphi",
    "part_charge", "part_d0val", "part_d0err", "part_dzval", "part_dzerr",
    "part_isElectron", "part_isMuon", "part_isPhoton", "part_isChargedHadron", "part_isNeutralHadron",
)
BASE_ARRAY_COLUMNS = ("part_energy", "part_deta", "part_dphi")
BASE_SCALARS = ("jet_pt", "jet_sdmass", "jet_nparticles")
VERIFICATION_BOUNDARY = (
    "Every downloaded column/footer byte range is SHA256-verified against the local lock. "
    "Whole-shard SHA256 values are publisher LFS metadata; complete shards were not downloaded or locally hashed."
)
SAMPLING = (
    "Within each pinned official split/shard, keep label 0 for signal and labels 161..187 for background; "
    "sort eligible rows by SHA256(42:record_id), take half the split size per group, and sort output by record_id. "
    "These balanced educational cohorts do not represent natural class prevalence. No rows cross official splits."
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_id(repository: str, revision: str, path: str, index: int) -> str:
    return hashlib.sha256(f"{repository}@{revision}:{path}:{index}".encode()).hexdigest()


def measurement_columns(split: str) -> tuple[str, ...]:
    return (*BASE_SCALARS, *BASE_ARRAY_COLUMNS) if split == "train" else (*BASE_SCALARS, "jet_energy", *ARRAY_COLUMNS)


def dataset_id(splits: dict[str, Record]) -> str:
    """Content identity independent of output folder and JSON whitespace."""
    payload = {name: splits[name]["sha256"] for name in sorted(splits)}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def fetch_range(lock: Record, entry: Record, span: Record, cache_dir: Path, *, discover: bool = False) -> Path:
    target: object  # Rebound from the temporary file handle to the final Path below.
    cache_dir.mkdir(parents=True, exist_ok=True)
    digest = span.get("sha256")
    if digest:
        cached = cache_dir / f"{digest}.range"
        if cached.is_file() and cached.stat().st_size == span["length"] and sha256(cached) == digest:
            return cached
    elif not discover:
        raise ValueError("Source range is not pinned; use the reviewed data lock.")
    start, length = span["start"], span["length"]
    end = start + length - 1
    path = urllib.parse.quote(entry["path"], safe="/")
    url = (f"https://huggingface.co/datasets/{lock['repository']}/resolve/{lock['revision']}/"
           f"{path}?download=true&range={start}")
    for attempt in range(3):
        temporary = None
        try:
            LOGGER.info("Fetch %s %s: %.2f MB", entry["path"], span["kind"], length / 1e6)
            request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}", "User-Agent": "ringier-workshop/2"})
            with urllib.request.urlopen(request, timeout=120) as response:
                if response.status != 206 or response.headers.get("Content-Range") != f"bytes {start}-{end}/{entry['size_bytes']}":
                    raise ValueError("Server did not honor the exact byte range; refusing a full-shard download.")
                with tempfile.NamedTemporaryFile(dir=cache_dir, suffix=".partial", delete=False) as target:
                    temporary = Path(target.name)
                    remaining = length
                    while remaining:
                        chunk = response.read(min(1 << 20, remaining))
                        if not chunk:
                            raise ValueError("Incomplete source range.")
                        target.write(chunk)
                        remaining -= len(chunk)
                    if response.read(1):
                        raise ValueError("Source exceeded the bounded byte range.")
            actual = sha256(temporary)
            if digest and actual != digest:
                raise ValueError("Source range differs from pinned SHA256.")
            span["sha256"] = actual
            target = cache_dir / f"{actual}.range"
            temporary.replace(target)
            return target
        except (OSError, ValueError) as error:
            LOGGER.warning("Source attempt %d failed: %s", attempt + 1, error)
            if attempt == 2:
                raise RuntimeError(f"Could not obtain verified range {entry['path']}:{start}; no replacement data are generated.") from error
            time.sleep(2 ** attempt)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    raise AssertionError("unreachable")


def write_sparse(path: Path, entry: Record, spans: list[Record], range_paths: list[Path]) -> None:
    with path.open("wb") as target:
        target.truncate(entry["size_bytes"])
        for span, source_path in zip(spans, range_paths):
            target.seek(span["start"])
            with source_path.open("rb") as source:
                shutil.copyfileobj(source, target)


def discover_lock(cache_dir: Path, lock_path: Path = LOCK_PATH) -> Record:
    """Inspect pinned footer/labels first, then pin only required column ranges."""
    url = f"https://huggingface.co/api/datasets/{REPOSITORY}/tree/{REVISION}/data?limit=1000"
    with urllib.request.urlopen(url, timeout=30) as response:
        entries = {item["path"]: item for item in json.load(response)}
    lock: Record = {"version": 1, "repository": REPOSITORY, "revision": REVISION, "seed": SEED,
            "task": {"id": "xbb-vs-qcd-v1", "signal_labels": [0], "background_labels": list(range(161, 188))},
            "split_rows": SPLIT_ROWS, "sampling": SAMPLING, "source_verification": VERIFICATION_BOUNDARY,
            "license": {"declared": "MIT", "evidence_url": f"https://huggingface.co/datasets/{REPOSITORY}/blob/{REVISION}/README.md"},
            "files": []}
    # Inspect all label counts before downloading the measured arrays.
    for split, paths in SPLIT_FILES.items():
        for group, path in zip(("signal", "background"), paths):
            metadata = entries[path]
            entry = {"path": path, "split": split, "group": group, "size_bytes": metadata["size"],
                     "publisher_sha256": metadata["lfs"]["oid"], "row_groups": [0],
                     "measurement_columns": list(measurement_columns(split))}
            checkpoint = cache_dir / f"{metadata['lfs']['oid']}-{split}-ranges.json"
            if checkpoint.exists():
                cached = json.loads(checkpoint.read_text())
                if all(cached.get(key) == value for key, value in entry.items()):
                    lock["files"].append(cached)
                    continue
            footer = {"start": metadata["size"] - 65536, "length": 65536, "kind": "footer"}
            footer_path = fetch_range(lock, entry, footer, cache_dir, discover=True)
            footer_bytes = footer_path.read_bytes()
            if footer_bytes[-4:] != b"PAR1" or struct.unpack("<I", footer_bytes[-8:-4])[0] + 8 > len(footer_bytes):
                raise ValueError("Unexpected Parquet footer; revisit the bounded projection.")
            with tempfile.TemporaryDirectory(dir=cache_dir) as directory:
                sparse = Path(directory) / "source.parquet"
                write_sparse(sparse, entry, [footer], [footer_path])
                source = pq.ParquetFile(sparse)
                if source.num_row_groups != 1:
                    raise ValueError("This release expects one row group per pinned shard.")
                row_group = source.metadata.row_group(0)
                entry["row_count"] = row_group.num_rows
                spans = []
                needed = set(entry["measurement_columns"]) | {"jet_label"}
                for index in range(row_group.num_columns):
                    column = row_group.column(index)
                    name = column.path_in_schema.split(".")[0]
                    if name in needed:
                        offset = min(value for value in (column.dictionary_page_offset, column.data_page_offset) if value is not None and value >= 0)
                        spans.append({"start": offset, "length": column.total_compressed_size, "kind": name})
                if {span["kind"] for span in spans} != needed:
                    raise ValueError("Source measurements differ from the required schema.")
                label_span = next(span for span in spans if span["kind"] == "jet_label")
                label_path = fetch_range(lock, entry, label_span, cache_dir, discover=True)
                write_sparse(sparse, entry, [footer, label_span], [footer_path, label_path])
                labels = pq.ParquetFile(sparse).read_row_group(0, columns=["jet_label"])["jet_label"].to_pylist()
                count = sum(label == 0 if group == "signal" else 161 <= label <= 187 for label in labels)
                if count < SPLIT_ROWS[split] // 2:
                    raise ValueError(f"Insufficient {split}/{group} rows: {count}.")
                entry["eligible_rows"] = count
                entry["ranges"] = [footer, *spans]
                LOGGER.info("Confirmed %s/%s: %d eligible of %d source rows", split, group, count, len(labels))
            lock["files"].append(entry)
            checkpoint.write_text(json.dumps(entry, indent=2) + "\n")
    for entry in lock["files"]:
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda span: fetch_range(lock, entry, span, cache_dir, discover=True), entry["ranges"]))
        checkpoint = cache_dir / f"{entry['publisher_sha256']}-{entry['split']}-ranges.json"
        checkpoint.write_text(json.dumps(entry, indent=2) + "\n")
    lock["download_bytes"] = sum(span["length"] for entry in lock["files"] for span in entry["ranges"])
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n")
    return lock


def validate_row(row: Record, split: str, lock: Record) -> None:
    if row.get("split") != split:
        raise ValueError("Row split differs from its file.")
    source = next((entry for entry in lock["files"] if entry["path"] == row.get("source_file") and entry["split"] == split), None)
    index = row.get("source_row")
    if source is None or isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < source["row_count"]:
        raise ValueError("Source row is outside its official split/shard.")
    if row.get("record_id") != stable_id(lock["repository"], lock["revision"], row["source_file"], row["source_row"]):
        raise ValueError("record_id differs from source identity.")
    label = row.get("truth_label")
    if not isinstance(label, int) or isinstance(label, bool) or not (label == 0 or 161 <= label <= 187):
        raise ValueError("Truth label is outside the binary task.")
    if row.get("truth_group") != source["group"] or row.get("truth_group") != ("signal" if label == 0 else "background"):
        raise ValueError("Truth group does not match the source label.")
    count = row.get("jet_nparticles")
    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
        raise ValueError("jet_nparticles must be a positive integer.")
    for name in measurement_columns(split):
        value = row.get(name)
        if name.startswith("part_"):
            if not isinstance(value, list) or len(value) != count:
                raise ValueError(f"{name} is not aligned with jet_nparticles.")
            if any(item is None or not math.isfinite(item) for item in value):
                raise ValueError(f"{name} contains missing or nonfinite measurements.")
            if name.startswith("part_is") and any(not isinstance(item, bool) for item in value):
                raise ValueError(f"{name} must contain booleans.")
        elif value is None or not math.isfinite(value):
            raise ValueError(f"{name} must be finite.")
    if row["jet_pt"] <= 0 or (split != "train" and row["jet_energy"] <= 0):
        raise ValueError("Jet momentum and energy must be positive.")
    if any(value < 0 for value in row["part_energy"]) or sum(row["part_energy"]) <= 0:
        raise ValueError("Particle energy must be nonnegative with a positive sum.")
    if any(abs(value) > math.pi + 1e-6 for value in row["part_dphi"]):
        raise ValueError("Relative phi must lie within [-pi, pi].")


def projected_sample(lock: Record, entry: Record, cache_dir: Path) -> list[Record]:
    """Decode one row group; take selected rows before converting arrays to Python."""
    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = list(pool.map(lambda span: fetch_range(lock, entry, span, cache_dir), entry["ranges"]))
    with tempfile.TemporaryDirectory(dir=cache_dir) as directory:
        sparse = Path(directory) / "source.parquet"
        write_sparse(sparse, entry, entry["ranges"], paths)
        source = pq.ParquetFile(sparse)
        if entry["row_groups"] != [0] or source.metadata.row_group(0).num_rows != entry["row_count"]:
            raise ValueError("Source row-group identity differs from the lock.")
        table = source.read_row_group(0, columns=[*entry["measurement_columns"], "jet_label"], use_threads=False)
        labels = table["jet_label"].to_pylist()
        indices = [index for index, label in enumerate(labels)
                   if (label == 0 if entry["group"] == "signal" else 161 <= label <= 187)]
        if len(indices) != entry["eligible_rows"]:
            raise ValueError("Eligible label counts differ from the inspected source.")
        ids = {index: stable_id(lock["repository"], lock["revision"], entry["path"], index) for index in indices}
        indices.sort(key=lambda index: hashlib.sha256(f"{lock['seed']}:{ids[index]}".encode()).digest())
        indices = indices[:lock["split_rows"][entry["split"]] // 2]
        selected = table.take(pa.array(indices, type=pa.int64())).to_pylist()
        result = []
        for index, raw in zip(indices, selected):
            label = raw.pop("jet_label")
            row = {"record_id": ids[index], "source_file": entry["path"], "source_row": index,
                   "truth_label": label, "truth_group": entry["group"], "split": entry["split"], **raw}
            validate_row(row, entry["split"], lock)
            result.append(row)
        return result


def output_schema(split: str) -> pa.Schema:
    fields = [("record_id", pa.string()), ("source_file", pa.string()), ("source_row", pa.int64()),
              ("truth_label", pa.int32()), ("truth_group", pa.string()), ("split", pa.string())]
    for name in measurement_columns(split):
        if name.startswith("part_is"):
            kind = pa.list_(pa.bool_())
        elif name == "part_charge":
            kind = pa.list_(pa.int32())
        elif name.startswith("part_"):
            kind = pa.list_(pa.float32())
        else:
            kind = pa.int32() if name == "jet_nparticles" else pa.float32()
        fields.append((name, kind))
    return pa.schema(fields)


def validate_bundle(output_dir: Path, lock: Record, lock_digest: str) -> Record:
    manifest = json.loads((output_dir / "manifest.json").read_text())
    if (manifest.get("version") != 1 or manifest.get("repository") != lock["repository"]
            or manifest.get("revision") != lock["revision"] or manifest.get("seed") != lock["seed"]
            or manifest.get("data_lock_sha256") != lock_digest
            or manifest.get("source_files") != lock["files"]
            or manifest.get("sampling") != lock["sampling"]
            or manifest.get("source_verification") != lock["source_verification"]
            or manifest.get("simulated_collider_data") is not True
            or set(manifest.get("splits", {})) != set(lock["split_rows"])):
        raise ValueError("Bundle metadata does not match the current data lock.")
    seen: set[str] = set()
    for split, count in lock["split_rows"].items():
        details = manifest["splits"][split]
        if details.get("file") != f"{split}.parquet" or details.get("rows") != count:
            raise ValueError("Bundle split filenames or counts differ from the release.")
        path = output_dir / details["file"]
        if sha256(path) != details["sha256"]:
            raise ValueError(f"Bundle checksum mismatch: {split}.")
        table = pq.read_table(path)
        if not table.schema.equals(output_schema(split), check_metadata=False):
            raise ValueError(f"Bundle schema mismatch: {split}.")
        rows = table.to_pylist()
        ids = [row["record_id"] for row in rows]
        if len(rows) != count or len(set(ids)) != count or seen.intersection(ids):
            raise ValueError("Bundle has duplicate, overlapping or missing records.")
        if Counter(row["truth_group"] for row in rows) != {"signal": count // 2, "background": count // 2}:
            raise ValueError("Bundle is not balanced across its two truth groups.")
        for row in rows:
            validate_row(row, split, lock)
        seen.update(ids)
    if manifest.get("dataset_id") != dataset_id(manifest["splits"]):
        raise ValueError("dataset_id does not match the split file hashes.")
    return manifest


def prepare(output_dir: Path, cache_dir: Path, lock_path: Path = LOCK_PATH) -> Record:
    lock_bytes = lock_path.read_bytes()
    lock = json.loads(lock_bytes)
    lock_digest = hashlib.sha256(lock_bytes).hexdigest()
    if output_dir.exists():
        return validate_bundle(output_dir, lock, lock_digest)
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}-", dir=output_dir.parent))
    try:
        splits = {}
        observations = {}
        for split, count in lock["split_rows"].items():
            rows = []
            for entry in lock["files"]:
                if entry["split"] == split:
                    rows.extend(projected_sample(lock, entry, cache_dir))
            rows.sort(key=lambda row: row["record_id"])
            if len(rows) != count:
                raise ValueError(f"Prepared {len(rows)} rows instead of {count} for {split}.")
            name = f"{split}.parquet"
            pq.write_table(pa.Table.from_pylist(rows, schema=output_schema(split)), temporary / name, compression="snappy")
            splits[split] = {"file": name, "rows": len(rows), "sha256": sha256(temporary / name)}
            sizes = [row["jet_nparticles"] for row in rows]
            observations[split] = {"class_counts": dict(Counter(row["truth_group"] for row in rows)),
                                   "particle_count_min": min(sizes), "particle_count_max": max(sizes),
                                   "jets_over_128_particles": sum(size > 128 for size in sizes),
                                   "bytes": (temporary / name).stat().st_size}
            LOGGER.info("Prepared %s: %d jets", split, len(rows))
        manifest = {"version": 1, "dataset_id": dataset_id(splits), "repository": lock["repository"],
                    "revision": lock["revision"], "seed": lock["seed"], "splits": splits,
                    "data_lock_sha256": lock_digest, "simulated_collider_data": True,
                    "sampling": lock["sampling"], "source_verification": lock["source_verification"],
                    "source_files": lock["files"], "observations": observations,
                    "array_policy": "Full source arrays and order are retained. No clipping, padding, imputation or model-specific truncation during data preparation."}
        (temporary / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        validate_bundle(temporary, lock, lock_digest)
        temporary.rename(output_dir)
        return manifest
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def write_evaluation_reference(raw_dir: Path, manifest: Record, destination: Path) -> Record:
    """Freeze the canonical held-out truth once; never silently replace it."""
    reference = {"version": 1, "dataset_id": manifest["dataset_id"], "splits": {}}
    for split in ("validation", "test"):
        rows = pq.read_table(raw_dir / manifest["splits"][split]["file"],
                             columns=["record_id", "truth_label"]).to_pylist()
        reference["splits"][split] = [
            {"record_id": row["record_id"], "label": int(row["truth_label"] == 0)}
            for row in sorted(rows, key=lambda row: row["record_id"])
        ]
    if destination.is_symlink():
        raise ValueError("Canonical evaluation reference cannot be a symlink.")
    if destination.exists():
        if json.loads(destination.read_text()) != reference:
            raise ValueError("Canonical evaluation reference changed; choose a new explicit --reference-output for review.")
        LOGGER.info("Reusing matching canonical evaluation reference: %s", destination)
        return reference
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent,
                                         suffix=".partial", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(reference, stream, sort_keys=True, separators=(",", ":"), allow_nan=False)
            stream.write("\n")
        temporary.replace(destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    LOGGER.info("Created canonical evaluation reference: %s", destination)
    return reference


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--discover-lock", action="store_true", help="Inspect publisher metadata and pin bounded source ranges before preparing")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/01_raw")
    parser.add_argument("--cache-dir", type=Path, default=ROOT / ".cache/jetclass2")
    parser.add_argument("--reference-output", type=Path, default=ROOT / "config/evaluation.json")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        if args.discover_lock:
            discover_lock(args.cache_dir)
        manifest = prepare(args.output_dir, args.cache_dir)
        write_evaluation_reference(args.output_dir, manifest, args.reference_output)
        print(json.dumps({key: manifest[key] for key in ("dataset_id", "splits", "observations")}, indent=2))
        return 0
    except (OSError, ValueError, KeyError, RuntimeError, pa.ArrowException) as error:
        LOGGER.error("Data preparation failed: %s", error)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
