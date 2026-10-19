# Collision Lab

**[Workshop instructions →](https://ringier-collision-lab.openai.chatgpt.site/workshop)**

The starter is logistic regression with three features. Add your own experiments using the [model contract](docs/model-outputs.md).

## Prepare for the session

Run the [before-arrival setup prompt](docs/workshop-preparation.md). Facilitators can use the [two-hour walkthrough](docs/facilitator-walkthrough.md).

## Run

Requires Docker Compose and the four Site downloads in `data/01_raw/`.

```sh
docker compose build
docker compose run --rm --no-deps setup
docker compose run --rm --no-deps lab -m preprocessing
docker compose run --rm --no-deps lab -m predict
docker compose run --rm --no-deps lab -m postprocessing
```

Open `data/05_analytics/model-explorer.html` in Codex: **+ → Files**.

Tests: `docker compose run --rm --no-deps lab -m pytest -q`.

## Python type checks

Function annotations cover the pipeline, facilitator scripts and Blender asset
scripts. Shared contracts live in `src/workshop_types.py`. JSON/Parquet records
and participant-defined metadata retain dynamic fields; the existing runtime
validators still check their contents. Type-only imports do not load Spark,
models or Blender during ordinary module imports.

Run mypy in the workshop environment (the development tools are installed only
inside this disposable, network-enabled container):

```sh
docker compose run --rm --no-deps --entrypoint sh setup -c \
  'python3 -m pip install -r requirements-dev.txt && python3 -m mypy --cache-dir /tmp/mypy-cache'
```

For an environment that already has the workshop dependencies, install
`requirements-dev.txt` and run `python3 -m mypy`. The offline participant archive
omits the Site: use `python3 -m mypy src scripts` there.

Annotations preserve calculations and validation. Editing `features.py` still
changes its provenance hash, so rerun preprocessing before training with
previously prepared data. Existing saved results are not rewritten.

## Optional Sophon pack

Create `<run-name>-experiment-sophon` from your model branch first. Extract the [pack](https://ringier-collision-lab.openai.chatgpt.site/downloads/sophon-optional-v1.zip) into `optional/` in the model worktree, then run from that worktree:

```sh
docker run --rm --network none -v "$PWD:/workspace" particle-workshop:0.6.0 optional/sophon-optional/install.py /workspace
docker compose run --rm --no-deps lab -m predict --config config/experiments-sophon.yaml
docker compose run --rm --no-deps lab -m postprocessing
```
