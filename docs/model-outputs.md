# Model contract

Technical reference for Codex. Participant instructions are on the [Site](https://ringier-collision-lab.openai.chatgpt.site/workshop).

## Models and features

- Implement [Predictor](../src/predict/base.py) and register it in [PREDICTORS](../src/predict/models.py). Use [logistic.py](../src/predict/logistic.py) as the example: `train` saves the artifact and returns `trained` and actual `parameters`; `__init__` reloads it; `_predict` returns one finite score in `[0, 1]` per row, in input order.
- Add measured features to `DERIVED_FEATURES` in [features.py](../src/preprocessing/features.py), then rerun preprocessing. Preserve existing feature values. Labels and IDs never enter model inputs.
- Define the batch in `config/experiments.yaml`: unique IDs, explanations, `seed: 42`, `evaluation: validation`, `max_workers: 1`. Keep `linear-basic` unchanged: `model: logistic`, `features: basic`, default parameters (`C: 1.0`, `max_iter: 500`).
- Fit models and learned transforms on training rows only. Choose on validation; test only the chosen configuration at final evaluation.

Parameter names must be safe identifiers, without path/code keys. Values: finite numbers, booleans, null, enum strings matching `[A-Za-z][A-Za-z0-9_.:@-]{0,63}`, or lists with at most 32 elements and two list levels. Objects, code and paths are rejected.

## Generated outputs

Use the shared `predict` runner and `postprocessing` exporter; do not write replacement results. Run IDs are immutable: use a fresh ID for retries. Postprocessing collects successful runs; verify the baseline and every planned variant are present.

| Path | Contents |
|---|---|
| `data/03_predictions/<run>-<experiment>/result.json` | Status, model, features, parameters, metrics, timings and provenance |
| `data/03_predictions/<run>-<experiment>/predictions.parquet` | Evaluated jet IDs and scores |
| `models/<run>-<experiment>/` | Saved model and checksummed `manifest.json` |
| `data/05_analytics/comparison.json` | All successful experiments and their evaluation scores |
| `data/05_analytics/model-explorer.html` | Explorer with the comparison embedded |
| `data/05_analytics/analytics.duckdb` | Queryable comparison tables |
| `data/04_submissions/` | Submission JSON after final test evaluation |

Prediction columns are exactly `split` (string), `record_id` (unchanged string ID), and `signal_score` (float64). Validation produces 1,000 rows; final evaluation includes validation and test. Higher scores mean more signal-like, not calibrated probabilities.

In the comparison, join experiments to predictions by `experiment_key`, then scores to population by `(split, record_id)`. Calculate threshold counts from **all predictions**, not the limited `jets` display examples. Keep generated metadata and checksums intact; [the exporter](../src/postprocessing/compare.py) validates them against `config/evaluation.json`.

## Preserve results after merging

Copy the model worktree's `data/05_analytics/comparison.json` to `data/evidence/models/comparison.json` in the original checkout. After the integration run:

```sh
docker compose run --rm --no-deps lab -m postprocessing --import-comparison data/evidence/models/comparison.json
```

Include this argument each time you rebuild the combined comparison. It imports the saved validation batch without retraining; identical runs are deduplicated. Imports must use the same dataset and be at most 10 MiB. Conflicting runs or invalid scores stop the export before existing outputs change.
