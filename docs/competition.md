# Submission and ranking contract

Participant instructions are maintained on the [workshop Site](https://ringier-collision-lab.openai.chatgpt.site/workshop). This document describes the code and data contract.

`postprocessing.compare` creates final JSON in `data/04_submissions/`. The v1 payload includes dataset identity, the legacy `team` field (the Site’s participant ID), model/configuration metadata, split IDs and scores, metrics, timing protocol and explanation. `config/evaluation.json` is the fixed truth reference; participant postprocessing does not rewrite it.

`postprocessing.leaderboard.validate_submission` verifies the contract and recomputes quality from submitted scores. Its CLI validates final JSON files in a directory and produces a static leaderboard export. It does not run models. The hosted equivalent is `site/lib/competition.ts`, backed by authenticated API routes and D1.

| Contract | Hosted Site | Python collector |
|---|---|---|
| Upload/file limit | 1 MB | 2 MB / 5,000 predictions |
| Identity | Signed-in account owns its entry | `team` field |
| Persistence | Compact verified metrics in D1 | Static JSON export |
| Validation-only entries | Accepted, unranked | Final entries required |

Quality ranks final test ROC-AUC for participant-trained models. Efficiency ranks normalized inference time among trained entries within **0.02 AUC** of the best. Frozen Sophon is a separate reference and excluded from awards.

Normalized time is `(inference seconds / 128 jets) / (CPU reference seconds / 64 iterations)`. Timings and scores are participant-reported; quality is recomputed against fixed labels, but inference is not rerun centrally. Hardware correction is approximate. Sophon has richer inputs and prior training.

The offline viewer in `tools/results-preview/` reads exported JSON locally. The authenticated workshop Site is deployed through Sites; this repository has no GitHub Pages deployment workflow.
