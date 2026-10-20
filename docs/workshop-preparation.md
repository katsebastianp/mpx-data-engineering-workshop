# Before you arrive: check your workshop setup

Updated 20 October 2026. Use this for Collision Lab, the Spark/Docker workshop. JobMatch in `mpx-engineering-workshop` is a separate Node/React workshop.

Install and sign into Codex on the laptop you will bring. Use your participant GitHub account, open the workshop folder, and paste the prompt below. Allow time for the first image build and downloads before the session. Use the approved Docker setup you already have. If blocked, tell the facilitator so you can join a team with a working machine. Do not install several container runtimes during the workshop.

Hosted workshop access requires your account to be added to the Site separately.
If access is unavailable, use the [local startup prompt](../README.md#local-startup-prompt-for-codex)
first, then return to this readiness check. Guide startup alone does not verify
the lab runtime or sample data.

```text
Check my readiness for the Ringier Collision Lab:
https://github.com/RingierIMU/mpx-data-engineering-workshop

Keep this a setup check. Preserve files and branches. Do not push, create PRs, upload results, install host software, change credentials or enable integrations. Never display tokens. Continue independent checks when something is blocked.

1. Read applicable AGENTS.md and the README. Identify my OS, CPU architecture, selected project folder, Git identity and actual running container runtime/context. On Windows, distinguish native Windows from WSL 2. Check read access to the exact repository above, not the separate mpx-engineering-workshop JobMatch repository. If this folder is empty, you may clone main directly into it. Otherwise reuse it only if it is the correct repository root. Preserve any other contents. Record the commit and confirm README.md, compose.yaml and src/ are directly in the project root.

2. Report repository branch-write and PR permissions where available, and check local Git authentication separately from the GitHub connection. A clone does not prove push or review works. Do not create a test PR. Ask me to confirm the intended Codex account/workspace and that the repository appears in Code Review; keep these manual checks UNKNOWN until confirmed.

3. Inspect compose.yaml and Dockerfile. Check the running daemon, Compose, Linux architecture, repository bind mounts and the lab's 2-CPU/2-GiB limits. Flag ARM emulation. Use the existing company-approved runtime. Docker Desktop, Docker Engine, Colima, Podman and Rancher Desktop are possible options, but only a passing lab check establishes compatibility. Do not switch runtimes or change network/TLS policy. If containers are unavailable, report TEAM MACHINE NEEDED.

4. Check data/01_raw/ for train.parquet, validation.parquet, test.parquet and manifest.json. Verify against config/workshop-sample.lock.json using the repository verifier. If missing, list the files and point to https://ringier-collision-lab.openai.chatgpt.site/workshop?step=download-data. If hosted access is unavailable, ask the facilitator for those four pinned files instead; cloning the repository does not download them. Preserve existing files; never replace the independent lock or substitute data.

5. When source and runtime checks pass, use a unique Compose project name to run the documented image build and self-contained tests. Run setup when all four files are present. Missing data need not block the independent build/tests. Record commands, exit codes and elapsed times. Stop dependent steps on failure. Do not run model experiments or inspect test scores.

6. If hosted Site access is unavailable, check Node 22.13+ and npm for the local guide and point to site/README.md. Local progress and leaderboard results remain on that laptop; a local upload does not publish to the shared board. Keep any existing database and rehearsal progress.

Return a short PASS / BLOCKED / UNKNOWN table for repository, branch/PR access, runtime, data, build/setup/tests and app/account checks, with evidence and the smallest next action. End READY, READY WITH LIMITATIONS or BLOCKED. READY requires actual setup and tests to pass, not just an installed Docker client. Flag unresolved manual checks. Keep voice and Cloud optional.
```

Passing this check is preparation, not completion of the lab. Personal branch creation, PRs and the final leaderboard submission happen during the workshop. Voice and Cloud are optional.

If hosted access is unavailable, use the [local guide setup](../site/README.md). Ask the facilitator for the four pinned data files; cloning the repository does not download them.
