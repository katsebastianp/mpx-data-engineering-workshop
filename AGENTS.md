# Workshop work

- Follow the Site sequence: Plan experiments → Run experiments → Explore results → Choose model. Run the agreed batch before exploring; do not add an experiment loop.
- Read [the model output contract](docs/model-outputs.md) before implementing or running a model. Keep the unchanged logistic/basic baseline beside the planned variants.
- Use `Predictor`, the shared experiment runner and postprocessing exporter. Preserve their artifact formats and standard output paths; never handcraft replacement results.
- Train on the training split only. Choose on validation; evaluate the chosen configuration on test only at the final evaluation step.
