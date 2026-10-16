# Particle workshop code and data

Start with a three-feature logistic regression on simulated jets, then add and compare your own classifiers and features.

**Participant setup, prompts, exercises and submission steps live only on the [workshop Site](https://ringier-collision-lab.openai.chatgpt.site/workshop).**

## Run locally

Requires Docker Compose and the four Site sample downloads in `data/01_raw/`.

```sh
docker compose build
docker compose run --rm --no-deps setup
docker compose run --rm lab -m preprocessing
docker compose run --rm lab -m predict
docker compose run --rm lab -m postprocessing
```

The default `config/experiments.yaml` runs only logistic regression on `jet_pt`, `jet_sdmass` and `particle_count`. It scores 1,000 validation jets; the separate 1,000 test jets stay unused for model selection. Comparison batches include the unchanged logistic/basic baseline and use `max_workers: 1`.

The pipeline exercise changes only `SHUFFLE_PARTITIONS` in `src/preprocessing/pipeline.py` from 64 to 4. Save the existing `data/02_preprocessed/` folder as `data/02_preprocessed_baseline/` first; rerun preprocessing once after the edit. Verify every saved value and inspect recorded task counts/time without retraining:

```sh
docker compose run --rm lab scripts/compare_preprocessing.py data/02_preprocessed_baseline data/02_preprocessed
```

Fewer tasks may reduce overhead, but one timing per version is noisy. The comparison fails if any row, feature, label or particle array changes.

Early finishers can use the separate [Sophon pack](https://ringier-collision-lab.openai.chatgpt.site/downloads/sophon-optional-v1.zip), also suitable for the closing demo. It provides the pretrained integration and setup instructions. Run it as supplied; implementing or fine-tuning Sophon is outside this workshop.

In your model worktree, extract the ZIP into `optional/`, then run:

```sh
docker run --rm --network none -v "$PWD:/workspace" particle-workshop:0.6.0 optional/sophon-optional/install.py /workspace
docker compose run --rm lab -m predict --config config/experiments-sophon.yaml
docker compose run --rm lab -m postprocessing
```

The installer runs inside Docker, verifies the included files and stops on conflicting files. The pack includes the weights; no host Python, Spark run, package installation or image rebuild is needed.

Run checks with `docker compose run --rm lab -m pytest -q`.

## Code

| Path | Responsibility |
|---|---|
| `src/preprocessing/` | Measured features, Spark transforms and prepared-data manifests |
| `src/predict/` | Configuration validation, model fitting/loading, predictions and timing |
| `src/postprocessing/` | DuckDB tables, comparison exports and submission validation |
| `config/experiments.yaml` | Model/feature variants, seed, evaluation split and participant metadata |
| `config/*lock.json` | Pinned sample and upstream data provenance |
| `config/evaluation.json` | Fixed evaluation IDs and labels used to validate submissions |
| `tests/` | Pipeline, model, export and bundle checks |
| `scripts/` | Verified sample setup and maintainer data preparation |
| `tools/model-explorer/` | Source template for the generated Model Explorer |
| `site/` | Hosted workshop UI, accounts and leaderboard; full repository only |

The `Predictor` interface is in `src/predict/base.py`; each model has its own module. `AnalyticsStore` in `src/postprocessing/database.py` owns transactional database writes. `compose.yaml` mounts each checkout’s source and isolates its writable data/models, using a shared image with 2 CPUs and 2 GiB.

## Add a model or feature

| Change | Edit |
|---|---|
| Use more features | Set `features: shape` or an explicit feature list in your YAML |
| Tune logistic regression | Add `params`, such as `C`; its model module defines supported settings |
| Try XGBoost | Read its official documentation with Codex, implement a `Predictor` adapter, then register it |
| Add a classifier | Implement `Predictor` in `src/predict/`, then register its class in `PREDICTORS` in `models.py` |
| Calculate a new feature | Add a function and a `DERIVED_FEATURES` entry in `src/preprocessing/features.py`; rerun preprocessing |

A feature function receives only `ParticleMeasurements`. For example, `def mass_over_pt(jet): return jet.mass / jet.pt`; register `"mass_over_pt": mass_over_pt`, then select `features: [jet_pt, jet_sdmass, particle_count, mass_over_pt]` in YAML. Existing feature definitions stay unchanged. After merging, `scripts/compare_preprocessing.py BEFORE AFTER --allow-added-features` checks all original values while allowing the new columns.

A classifier implements `train` (save its artifact and return metadata including `trained` and `parameters`), `__init__` (load the artifact), and `_predict` (one signal score in `[0, 1]` per row). The runner supplies train rows only; inference receives declared measurements without labels or IDs. Use the logistic module as a small example. Scikit-learn and XGBoost are already installed; adding an adapter needs no image rebuild. Other dependencies belong in `requirements.txt` and require a rebuild.

`predict` runs the configured batch; `postprocessing` collects its results and generates `data/05_analytics/model-explorer.html`, with the comparison data embedded. All classifiers follow the [model output contract](docs/model-outputs.md), using the shared runner and exporter. The starter implements only logistic regression.

## Data and artifacts

```text
data/01_raw/                 Site-hosted train/validation/test Parquet and manifest
data/02_preprocessed/        measured features and source-hashed manifest
data/03_predictions/<run>-<experiment>/  result.json and predictions.parquet
data/04_submissions/         generated final-result JSON
data/05_analytics/           analytics.duckdb, comparison.json and model-explorer.html
models/<run>-<experiment>/   manifest.json and the saved model
data/evidence/              local experiment snapshots
```

Payloads and generated outputs are ignored by Git. The Site hosts the fixed 6,000-row sample as four individual files; `config/workshop-sample.lock.json` pins their sizes and SHA-256 hashes. `scripts/setup_workshop.py` verifies these files only. The `lab` service remains offline; the core workshop needs no model download or Hugging Face account.

`.worktreeinclude` copies ignored raw/prepared inputs into local Codex-managed worktrees. Generated outputs remain separate. The core participant workflow uses the Site and Git checkout; Sophon is distributed separately.

[Data/schema reference](docs/data.md) · [Feature meanings](docs/problem-guide.md) · [Model output contract](docs/model-outputs.md) · [Submission contract](docs/competition.md) · [Historical validation](docs/results.md) · [Site development](site/README.md)
