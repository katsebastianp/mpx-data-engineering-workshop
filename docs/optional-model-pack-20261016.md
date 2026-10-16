# Optional model pack — 16 October 2026

The starter implements only logistic regression. XGBoost stays installed for participant implementations. Sophon is distributed separately as a ready-to-run frozen reference.

- Starter branch: `workshop/e2e-redesign-20261015`.
- Previous starter commit: `34f9b7c`.
- Optional source: branch `workshop/sophon-optional-20261016`, commit `81d3e00`.
- Download: `/downloads/sophon-optional-v1.zip` (8,667,670 bytes).
- ZIP SHA-256: `d2f543f25cf8523652e91a45a1472c2e81bc9908fbbe77cb766e288c50715ab3`.
- Previous Site version: 19. Preserve its existing restricted audience.

## Verification

- Core Docker suite: 167 passed.
- Installer suite: 25 passed; checksum and conflict checks preserve existing files.
- Extracted starter: setup verified 6,000 rows; only logistic/basic ran, with 1,000 validation predictions and ROC-AUC 0.75268.
- Optional installation: 10 new files; a repeat installed 0 files.
- Optional inference: 1,000 validation predictions, ROC-AUC 0.9964. Scores exactly match the saved reference (maximum difference 0).
- Postprocessing exported both experiments together. No test predictions or Spark rerun were required.
- Site suite: 86 passed.

The Docker image and dependencies are unchanged. The installer uses `docker run` because the Compose lab mount is read-only. Source/configuration changes take effect through the mounted worktree.

## Rollback

Revert the single starter change commit and redeploy Site version 19. The separate optional branch can remain archived; it has no effect unless its pack is installed. Pre-existing local edits were preserved and excluded from publication.
