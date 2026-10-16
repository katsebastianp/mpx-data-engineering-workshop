# Recorded validation

## One baseline — 16 October 2026

**175 Docker tests passed.** The default run fitted one logistic regression with three supplied features, scored 1,000 validation jets (ROC-AUC **0.75268**), and exported one experiment. Reloaded predictions matched exactly. All original prepared values across 6,000 jets were unchanged; no test scores were evaluated. A saved Sophon artifact still loaded and reproduced one recorded score. [Recorded evidence](validation/single-baseline-20261016.json).

## Shorter core — 15 October 2026

This historical revision ran two trained models; the current default is logistic regression only. **142 Docker tests passed** at that revision. An isolated run with the unchanged 6,000-jet sample verified setup with `--skip-sophon`, preprocessing, both models, and DuckDB export. Both models scored validation only: 1,000 predictions each; AUC **0.75268** for logistic regression and **0.830294** for XGBoost.

The one-setting pipeline exercise was checked in separate fresh Python/JVM processes:

| Shuffle partitions | Scheduled tasks | Preprocessing time | Saved values |
|---|---:|---:|---|
| 64, supplied baseline | 68 | 7.93 s | Reference |
| 4, participant change | 8 | 7.45 s | All 6,000 rows exactly equal in every column |

This demonstrates fewer tasks, with only a small observed time difference. It is one run per setting, not a guaranteed speedup. The equivalence helper reads the saved outputs without rerunning Spark or training.

Setup verification through export took **10.10 s inside a prebuilt ARM64 container**, with 2 CPU / 2 GiB limits and no OOM events. Model fitting, scoring and timing took 0.92 s; export took 0.71 s. These measurements exclude Docker startup, driver imports, image building, downloading, participant interaction and Codex response time. Physical Windows/WSL and 8-GB laptop rehearsal remains open. [Recorded evidence](validation/core-redesign-20261015.json).

Run the current core with the commands in [README](../README.md). For the exercise, preserve `data/02_preprocessed_baseline`, change only the partition count, run preprocessing once, then run `scripts/compare_preprocessing.py` against the two output folders.

## v0.6 layout verification — 12 October 2026

- **107 Docker tests passed**; the default preprocessing → predict → postprocessing flow completed.
- All **4,000 new predictions**, metrics and native model checksums matched their previous counterparts exactly. The migration preserved 26 original files and resolved all five original model references.
- Existing runs remained available; this verification database contains nine experiments and 10,000 predictions.
- [Layout verification](validation/layout-v06.json). Physical Windows/WSL 2 and 8-GB MacBook Air rehearsal remains open.

## Earlier performance evidence

**Historical v0.5 evidence:** recorded before the v0.6 package/folder reorganisation. The linked verification JSON retains its original paths and source hashes. These timings are not a new v0.6 benchmark.

Real data, real training and inference, **2 CPU / 2 GiB**, native ARM64 Linux containers. Seed **42**; 4,000 training jets, 1,000 validation jets, 1,000 separate test jets.

| Model | Features | Validation ROC-AUC | Inference ms / jet |
|---|---|---:|---:|
| Logistic regression | 3 basic | 0.7527 | 0.00066 |
| XGBoost | 3 basic | 0.8303 | 0.00180 |
| XGBoost | 8 measured | **0.8544** | 0.00226 |
| Sophon, frozen reference | Particle tensors | 0.9964 | 14.89938 |

- Latency: **128 fixed validation jets**, one warmup, median of three repeats, one thread. Includes input conversion; excludes model loading.
- Sophon uses **batch 1**; tabular models process one 128-jet batch. Times compare these complete implementations.
- Selected XGBoost using validation only. One final test: **AUC 0.85549**, **77.8% accuracy**, **F1 0.7832**.
- These are small, balanced simulated cohorts. Sophon has prior training and richer inputs; it stays outside the team awards.

## Complete flow: two fresh kits

Same built image, configuration and resource limits; each extraction started with empty results. Folder names contained spaces.

| Run | Preprocess | Four models | DuckDB + export | Total, including Docker startup |
|---|---:|---:|---:|---:|
| 1 | 8.28 s | 25.15 s | 1.04 s | **35.47 s** |
| 2 | 8.34 s | 25.20 s | 0.94 s | **35.25 s** |

- Each run: **6,000 prepared jets**, **68 scheduled Spark tasks**, **4,000 saved predictions** on 1,000 validation jets across four models.
- Preprocessing: **719–725 jets/s**, including Python startup. Full flow: **113 saved predictions/s**, including Docker startup; image build excluded.
- Peak container memory across all six commands: **0.89 GiB**; **zero OOM events**.
- Every saved model was reloaded: all **8,000 predictions** exactly matched the saved results. Prepared Parquet and model checksums also matched across runs.
- [Fresh-kit verification](validation/participant-kit-v05.json).

## Checks

- Full Docker test suite: **99 passed in 7.75 seconds**.
- Real preprocessing, four-model comparison, final submission and standard-library leaderboard builder passed.
- Database: **6,000 jets, 272,403 particles, five experiments, 6,000 predictions**. A detached copy opened with external file access disabled and retained all counts and the final test AUC. Quality is independently recomputed from saved scores.
- Two concurrent lightweight model fits: **343 MiB peak**, **zero OOM events**. Every prediction and model checksum exactly matched serial runs. Timing measurements still ran serially.
- Browser: final/validation split, training-range filter, jet display and threshold controls checked against full populations. Narrow-screen layout checked.
- [Parallel-run evidence](validation/parallel.json). New runs save their evidence in `data/03_predictions/<run>/result.json`.

## Laptop boundary

- Default: one fit at a time; Spark exits before model work; no GPU or inference key.
- Final ARM64 and AMD64 images built. AMD64 emulation passed small-model training/reload and one-jet Sophon CPU inference at **1 CPU / 1 GiB**, with no OOM. [Compatibility evidence](validation/amd64-v05.json).
- Container memory excludes Docker, the OS, Codex and the browser.
- **Physical Windows/WSL 2 and 8-GB MacBook Air rehearsals remain required.** Linux container limits are useful evidence, not laptop certification.
- v0.4 four-variant benchmarks belong to the archived runtime. They are not a speedup claim for this redesigned pipeline.
