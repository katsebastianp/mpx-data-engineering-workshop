# Data and output contract

## Inputs

`articles.parquet`: unique `article_id` (SHA256 of source + original ID), `source_id`, `publisher`, `text`, nullable `created_raw`, `url`, nullable `author`, nullable `license`. Fields are strings. Publication dates remain raw because source formats vary.

`events/`: eight Parquet files with unique `event_id`, valid `article_id`, UTC `event_time`, and finite, non-negative `reading_seconds`. Duplicate IDs, orphan references, missing required fields and invalid durations fail validation. Daily reports use the **event date in UTC**, not publication date.

## Reading-time ratio

- A word is a match of `[A-Za-z0-9]+`. This simple English token rule is fixed for the exercise.
- Estimated duration is `max(1, word_count * 60 / 200)` seconds.
- Ratio is `min(1, reading_seconds / estimated_duration)`; an empty/non-word body has ratio zero.
- This is a time-based engagement proxy, not measured reading completion.

## Outputs

| Report | Group keys | Measures |
|---|---|---|
| `article_report` | `event_date`, `article_id`, `publisher` | `read_count`, `total_reading_seconds`, `avg_reading_ratio` |
| `publisher_report` | `event_date`, `publisher` | Same measures |

`quality.json` records read count, total reading seconds and average/minimum/maximum reading ratio. Its check must run before publication. Neither missing rows nor removed checks are acceptable performance improvements.

Verification compares exact keys/counts and floating-point measures with relative tolerance `1e-9`, absolute tolerance `1e-8`. Row order and Parquet file names are not part of the output contract. Expected values are computed independently from prepared inputs.

The initial pipeline supports input version 1 only. A future monitoring exercise will introduce `reading_ms`; conversion/repair logic is intentionally not implemented yet.
