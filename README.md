# News readership pipeline

A working PySpark pipeline for a Codex workshop. Investigate its execution evidence and improve runtime while preserving its reports and quality checks. CPU and memory limits stay fixed.

This first version includes public news data, synthetic reading events, Docker, Spark UI, saved execution history and correctness tests. The monitoring agent and GitHub workflow come next.

## Run

Requirements: Docker with Compose and Linux containers. The pinned base image provides ARM64 and AMD64 variants; this starter has been run on ARM64 macOS. AMD64 and Windows still need a rehearsal. Allow at least 6 GB of Docker memory for the 4-GB pipeline container, History Server and runtime overhead. The first build/download needs internet access; prepared runs use cached data.

```sh
docker compose up -d --build history
docker compose run --rm pipeline doctor
docker compose run --rm pipeline prepare --profile smoke
docker compose run --rm --service-ports pipeline run --profile smoke
```

- **Live Spark UI:** http://localhost:4040 while the pipeline runs.
- **History Server:** http://localhost:18080, including completed runs. Open a run's SQL and Stages tabs.

Use the workshop workload after the smoke run:

```sh
docker compose run --rm pipeline prepare --profile workshop
docker compose run --rm --service-ports pipeline run --profile workshop
```

| Profile | Articles | Synthetic reading events |
|---|---:|---:|
| `smoke` | 200 | 2,000 |
| `workshop` | 10,000 | 250,000 |

The same configuration is used for both profiles. Only one preparation/pipeline run is allowed at a time. Keep `--service-ports` when launching a pipeline to expose its live UI.

## Inspect and verify

```sh
docker compose run --rm pipeline runs
docker compose run --rm pipeline show RUN_ID --section evidence
docker compose run --rm pipeline verify RUN_ID
docker compose run --rm --entrypoint python3 pipeline -m pytest -q -p no:cacheprovider
```

Each run saves its input manifest, source fingerprint, effective Spark configuration, stage timings, driver log, SQL plans, event-log summary, quality result and both Parquet reports. The optional `run --source-commit COMMIT` records the host revision; the source fingerprint is always computed from the mounted Python/config files. Verification independently calculates expected results from the inputs; its time is outside the pipeline benchmark.

State persists in the project-scoped Docker volume. Export run artifacts while the History Server is running:

```sh
docker compose cp history:/state/runs ./artifacts
```

Source and configuration are mounted from this checkout. Edit `src/news_pipeline/` or `config/spark-defaults.conf` and start a new run; ordinary Python/config edits need no image rebuild. Rebuild when dependencies change. Compare the same data profile and fixed resources, with consistent cache conditions. Timings include startup, validation, quality checks, both report writes and shutdown.

## Data

[Common Pile News](https://huggingface.co/datasets/common-pile/news), pinned by repository revision and SHA256 checksums in `config/dataset.lock.json`. Three source files total about 21 MB compressed. The initial download needs no Hugging Face token. Files are verified before use and cached; failures never fall back to fabricated articles.

The sample retains full text, original IDs, corpus source, raw publication date, URL, author and upstream licence metadata. A deterministic filter requires a valid URL, identifiers and at least 100 word tokens; it reduces navigation/short extracts but does not guarantee every retained page is an article. `publisher` means the corpus source label, not independently verified ownership of every linked page. Licence values are retained upstream assertions; review source reuse terms before wider distribution. Article data is not committed to Git.

Reading events are explicitly synthetic, generated with seed 42 across a fixed seven-day period. See [the data and output contract](docs/contract.md).

## Stop

```sh
docker compose down
```

This keeps the dataset and run history. `docker compose down -v` also deletes that workshop state. A changed seed or modified prepared file is rejected; use a fresh project volume when deliberately changing the dataset.
