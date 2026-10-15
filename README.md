# Particle workshop code and data

Prepare simulated particle jets with Spark, compare two simple classifiers, and explore their predictions. The frozen Sophon model is an optional extension.

**Participant setup, prompts, exercises and submission steps live only on the [workshop Site](https://ringier-collision-lab.openai.chatgpt.site/workshop).**

## Run locally

Requires Docker Compose and the four Site sample downloads in `data/01_raw/`.

```sh
docker compose build
docker compose run --rm --no-deps setup scripts/setup_workshop.py --skip-sophon
docker compose run --rm lab -m preprocessing
docker compose run --rm lab -m predict
docker compose run --rm lab -m postprocessing
```

The default `config/experiments.yaml` trains logistic regression and XGBoost using the same three measurements. It scores the 1,000 validation jets; the separate 1,000 test jets stay unused for model selection. Choose one experiment on validation before setting `evaluation: test` for a final run. Keep `max_workers: 1` for the core workshop; extra runs and models are optional.

The pipeline exercise changes only `SHUFFLE_PARTITIONS` in `src/preprocessing/pipeline.py` from 64 to 4. Save the existing `data/02_preprocessed/` folder as `data/02_preprocessed_baseline/` first; rerun preprocessing once after the edit. Verify every saved value and inspect recorded task counts/time without retraining:

```sh
docker compose run --rm lab scripts/compare_preprocessing.py data/02_preprocessed_baseline data/02_preprocessed
```

Fewer tasks may reduce overhead, but one timing per version is noisy. The comparison fails if any row, feature, label or particle array changes.

For the optional pretrained reference, run `docker compose run --rm --no-deps setup` without the skip flag, then `docker compose run --rm lab -m predict --config config/experiments-sophon.yaml`. That path downloads and verifies the pinned model; it adds setup and inference time. Missing assets fail with an explicit setup instruction.

Run checks with `docker compose run --rm lab -m pytest -q`.

## Code

| Path | Responsibility |
|---|---|
| `src/preprocessing/` | Measured features, Spark transforms and prepared-data manifests |
| `src/predict/` | Configuration validation, model fitting/loading, predictions and timing |
| `src/postprocessing/` | DuckDB tables, comparison exports and submission validation |
| `config/experiments.yaml` | Model/feature variants, seed, evaluation split and participant metadata |
| `config/*lock.json`, `config/sophon-contract.json` | Pinned data/model provenance and adapter contract |
| `config/evaluation.json` | Fixed evaluation IDs and labels used to validate submissions |
| `tests/` | Pipeline, model, export and bundle checks |
| `scripts/` | Verified sample setup, pinned model download, and maintainer data preparation |
| `tools/results-preview/` | Offline viewer for exported comparison JSON |
| `site/` | Hosted workshop UI, accounts and leaderboard; full repository only |

The `Predictor` interface is in `src/predict/base.py`; each model has its own module. `AnalyticsStore` in `src/postprocessing/database.py` owns transactional database writes. `compose.yaml` mounts each checkout’s source and isolates its writable data/models, using a shared image with 2 CPUs and 2 GiB.

## Data and artifacts

```text
data/01_raw/                 Site-hosted train/validation/test Parquet and manifest
data/02_preprocessed/        measured features and source-hashed manifest
data/03_predictions/<run>/   predictions, metrics and model references
data/04_submissions/         generated final-result JSON
data/05_analytics/           DuckDB database and comparison JSON
models/pretrained/sophon/    downloaded frozen model and provenance
models/<run>/               separately saved trained models
evidence/                   local immutable experiment snapshots
```

Payloads and generated outputs are ignored by Git. The Site hosts the fixed 6,000-row sample as four individual files; `config/workshop-sample.lock.json` pins their sizes and SHA-256 hashes. `scripts/setup_workshop.py` validates them; `--skip-sophon` explicitly skips the optional model download. Without that flag it also verifies/downloads pinned Sophon weights and publisher provenance through the network-enabled Compose `setup` service. The `lab` service remains offline. No Hugging Face account is required.

`.worktreeinclude` copies ignored raw/prepared inputs and pretrained Sophon into local Codex-managed worktrees. Generated outputs remain separate. The ZIP builder is retained only for legacy offline archives; the participant workflow uses the Site and Git checkout.

[Data/schema reference](docs/data.md) · [Feature meanings](docs/problem-guide.md) · [Submission contract](docs/competition.md) · [Historical validation](docs/results.md) · [Site development](site/README.md)
