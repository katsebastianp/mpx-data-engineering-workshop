# Collision Lab

The starter is logistic regression with three features. Add your own experiments using the [model contract](docs/model-outputs.md).

## Start the workshop

The [ChatGPT workshop Site](https://ringier-collision-lab.openai.chatgpt.site/brief)
contains the brief, step-by-step instructions and shared leaderboard. Your
account must be added to the Site's access list before you can use it. Ask the
facilitator to confirm access, then sign in with that account. GitHub repository
access and Codex access do not automatically grant access to the Site.

If hosted access is unavailable, run the copy in this repository locally. It
contains the same guide and does not require a hosted Site invitation. Use one
prepared machine per team if needed. The guide needs **Node 22.13+ and npm**;
the lab exercises separately need the approved Docker/Compose setup and data.
On Windows, use WSL 2. See [local setup commands](site/README.md).

### Local startup prompt for Codex

Open your intended workshop folder in Codex and paste:

```text
Start the Ringier Collision Lab guide locally:
https://github.com/RingierIMU/mpx-data-engineering-workshop

1. Read AGENTS.md, README.md and site/README.md. Reuse the correct checkout and preserve existing files, branches, databases and progress. If this folder is empty, clone main into it. Otherwise do not clone over its contents or switch branches automatically; report a missing or outdated guide.
2. Check Node 22.13+ and npm. On Windows, use the documented WSL 2 setup. Report missing host software without installing it automatically.
3. Follow site/README.md: install the guide dependencies, build it, and apply all documented migrations to a fresh local database. For an existing database, inspect which migrations are pending; do not rerun the fresh-database loop or delete existing state.
4. Reuse a healthy guide server for this checkout, or start one bound to 127.0.0.1. If the port is occupied by something else, choose a free local port and report it. Open /brief, then verify Instructions loads and local sign-in works. This is simulated local sign-in, not a hosted ChatGPT login. Leave any existing run intact; let me choose a unique run name in the guide.
5. Return the local URL and a short PASS / BLOCKED / UNKNOWN summary with evidence and the smallest next action. Guide startup does not prove the lab runtime or data is ready. Point me to docs/workshop-preparation.md for that separate check. If hosted downloads are inaccessible, ask the facilitator for the four pinned sample files.

Start only the guide. Do not train models, inspect test scores, push, create PRs, upload results or change credentials.
```

Local progress and leaderboard results stay on that laptop. They do not sync
to the shared Site. If you cannot use the shared leaderboard, keep the generated
final JSON in `data/04_submissions/` and give it to the facilitator.

## Prepare for the session

Run the [before-arrival setup prompt](docs/workshop-preparation.md), including
the repository, runtime, data and container checks. Get `train.parquet`,
`validation.parquet`, `test.parquet` and `manifest.json` from the hosted downloads
or the facilitator and place them in `data/01_raw/`. Cloning the repository does
not download these files. Facilitators can use the [two-hour walkthrough](docs/facilitator-walkthrough.md).

## Run

Requires Docker Compose and the four verified sample files in `data/01_raw/`.

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
