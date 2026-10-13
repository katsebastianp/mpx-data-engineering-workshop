# Particle workshop code and data

Docker-based Spark preprocessing, logistic/XGBoost experiments, a frozen Sophon reference, and DuckDB analysis of simulated JetClass-II jets.

**Participant setup, prompts, exercises and submission steps live only on the [workshop Site](https://ringier-collision-lab.openai.chatgpt.site/workshop).**

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
| `scripts/` | Maintainer data preparation and deterministic participant ZIP packaging |
| `tools/results-preview/` | Offline viewer for exported comparison JSON |
| `site/` | Hosted workshop UI, accounts and leaderboard; full repository only |

The `Predictor` interface is in `src/predict/base.py`; each model has its own module. `AnalyticsStore` in `src/postprocessing/database.py` owns transactional database writes. `compose.yaml` mounts each checkout’s source and isolates its writable data/models, using a shared image with 2 CPUs and 2 GiB.

## Data and artifacts

```text
data/01_raw/                 supplied train/validation/test Parquet and manifest
data/02_preprocessed/        measured features and source-hashed manifest
data/03_predictions/<run>/   predictions, metrics and model references
data/04_submissions/         generated final-result JSON
data/05_analytics/           DuckDB database and comparison JSON
models/pretrained/sophon/    supplied frozen model and provenance
models/<run>/               separately saved trained models
evidence/                   local immutable experiment snapshots
```

Payloads and generated outputs are ignored by Git. The participant ZIP contains the raw data, frozen Sophon assets, runtime code and offline viewer; it excludes hosted Site source and participant results. `.worktreeinclude` copies ignored raw/prepared inputs and pretrained Sophon into local Codex-managed worktrees. Generated outputs remain separate.

[Data/schema reference](docs/data.md) · [Feature meanings](docs/problem-guide.md) · [Submission contract](docs/competition.md) · [Historical validation](docs/results.md) · [Site development](site/README.md)
