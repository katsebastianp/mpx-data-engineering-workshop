# Collision Lab

**[Workshop instructions →](https://ringier-collision-lab.openai.chatgpt.site/workshop)**

The starter is logistic regression with three features. Add your own experiments using the [model contract](docs/model-outputs.md).

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

## Optional Sophon pack

Extract the [pack](https://ringier-collision-lab.openai.chatgpt.site/downloads/sophon-optional-v1.zip) into `optional/` in the model worktree, then run from that worktree:

```sh
docker run --rm --network none -v "$PWD:/workspace" particle-workshop:0.6.0 optional/sophon-optional/install.py /workspace
docker compose run --rm --no-deps lab -m predict --config config/experiments-sophon.yaml
docker compose run --rm --no-deps lab -m postprocessing
```
