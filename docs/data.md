# Data and results

Start with the [audience guide](problem-guide.md) for the problem, feature meanings and two real data examples.

## Fixed cohorts

[JetClass-II](https://huggingface.co/datasets/jet-universe/jetclass2) supplies simulated collider jets; its pinned card declares MIT licensing. Signal is **X→bb, label 0**; background is **QCD, labels 161–187**.

| Split | Jets | Signal / background | Official source shards |
|---|---:|---:|---|
| Train | 4,000 | 2,000 / 2,000 | Res2P_0000 / QCD_0000 |
| Validation | 1,000 | 500 / 500 | Res2P_0200 / QCD_0280 |
| Test | 1,000 | 500 / 500 | Res2P_0251 / QCD_0351 |

Seed 42 and hashed source identities define disjoint, balanced samples. Balance is educational, not natural collider prevalence. [The data lock](../config/workshop-data.lock.json) pins revision, columns and downloaded-range hashes. Whole-shard hashes are publisher metadata; complete shards were not downloaded. The facilitator prepares the **8.1 MB** sample once. The workshop Site distributes its three Parquet files and manifest directly, without an archive or a full upstream download.

`data/01_raw/manifest.json` records split hashes and dataset identity. The facilitator’s `scripts/prepare_data.py` also freezes `config/evaluation.json`; participant postprocessing only validates it. Null, nonfinite or misaligned measured arrays are rejected; raw arrays retain their complete lengths. Validation/test include all Sophon measurements; training carries the smaller numerical-feature inputs.

`config/workshop-sample.lock.json` independently pins all four downloadable files. `docker compose run --rm --no-deps setup` verifies their bytes and raw-data contract. It downloads no models. The sample payloads are excluded from Git.

## Features and scores

`src/preprocessing/features.py` defines eight measured features, including pairwise angular energy correlation. Labels, source identifiers and generator truth are excluded.

The default config runs only logistic regression using jet momentum, jet mass and particle count. Participants research and implement their chosen classifier integration, features or parameter changes. Scikit-learn and XGBoost are preinstalled; only logistic regression has a starter implementation. All training uses the train split; validation selects the approach, and test is scored once after that choice. The feature registry in `src/preprocessing/features.py` accepts additional calculations from measured inputs; rerun preprocessing after changing that file.

The separate [Sophon pack](https://ringier-collision-lab.openai.chatgpt.site/downloads/sophon-optional-v1.zip) is for early finishers or the closing demo. Its supplied frozen ONNX integration uses at most 128 particles; raw arrays remain complete. Its support flag means **200 < jet_pt < 2500 GeV** and **20 < jet_sdmass < 500 GeV**. It is a pretrained comparison, not an implementation or fine-tuning exercise.

Model scores rank jets from more background-like to more signal-like; they are not calibrated probabilities. Simulation truth stays separate from model inputs.

## Query the actual database

Open `data/05_analytics/analytics.duckdb` in a DuckDB-compatible SQL client. `postprocessing` writes `datasets`, `jets`, `particles`, `experiments`, `predictions`, `metrics` and the `experiment_comparison` view.

```sql
SELECT team, model, feature_set, roc_auc,
       normalized_inference_time
FROM experiment_comparison
WHERE split = 'validation'
ORDER BY roc_auc DESC;

SELECT split, truth_group, count(*) AS jets
FROM jets
GROUP BY split, truth_group
ORDER BY split, truth_group;
```

Both queries have been checked against the workshop database. `data/05_analytics/comparison.json` includes complete evaluation predictions/populations and up to 200 display jets. Threshold analysis uses the complete population. Particle `deta`/`dphi` describe momentum angles, not spatial detector tracks; energy is in GeV.

The jets table reflects current preprocessed features. Keep baseline copies to reconstruct older feature experiments; predictions retain their feature-source hash.
