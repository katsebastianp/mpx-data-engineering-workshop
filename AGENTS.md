# Workshop work

- Follow the Site sequence: Plan experiments → Run experiments → Explore results → Choose model. Run the agreed batch before exploring; do not add an experiment loop.
- Read [the model output contract](docs/model-outputs.md) before implementing or running a model. Keep the unchanged logistic/basic baseline beside the planned variants.
- Use `Predictor`, the shared experiment runner and postprocessing exporter. Preserve their artifact formats and standard output paths; never handcraft replacement results.
- Postprocessing writes `data/05_analytics/comparison.json` and the self-contained `model-explorer.html` beside it. Verify all planned experiments and the baseline are present, then open that HTML from the same worktree; no manual JSON loading or reruns during exploration.
- Train on the training split only. Choose on validation; evaluate the chosen configuration on test only at the final evaluation step.
