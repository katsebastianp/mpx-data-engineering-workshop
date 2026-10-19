# Collision Lab: two-hour walkthrough

This is a guided session with preparation completed beforehand. A cold laptop setup plus unrestricted model development is not a reliable two-hour workshop. Keep the existing Plan, Run, Explore, Choose sequence. Keep Cloud and Sophon optional.

## Before the session

Participants install and sign into Codex, verify GitHub access to `RingierIMU/mpx-data-engineering-workshop`, download the four locked sample files, and complete the [preparation prompt](workshop-preparation.md). This is a different repository from the Node/React JobMatch workshop at `mpx-engineering-workshop`.

Each team needs one working, company-approved Docker/Compose machine. Pair people whose machines are blocked. Existing alternatives must pass the same precheck; do not spend session time installing runtimes. Check the actual Windows/WSL or ARM laptop, rather than assuming another machine's result transfers.

The presenter checks the intended Codex profile/account, repository, microphone, native prompt handoff and PR review before the room arrives. Open the workshop Site, the project and one saved validation-only Explorer as a recovery aid. The Site's hosted content must match the reviewed branch if demonstrating revised wording. A source branch alone does not deploy the Site.

## Run of show

| Minutes | Click or action | Participant decision / visible checkpoint |
| --- | --- | --- |
| 00-05 | Physics, then Workshop brief. Explain signal/background and the 4,000 / 1,000 / 1,000 split. | Training learns, validation chooses, test is held until the end. Confirm every team has a working machine. |
| 05-10 | Instructions: Create project, Download data, Personal branch. Reuse the prepared checkout. | Correct repository root and four locked files. Personal branch exists on GitHub; shared main is unchanged. |
| 10-18 | Explore the code. Generate/open the HTML overview and inspect two nodes. | Identify preprocessing, model registration and output contract. Use up to two minutes of voice here: “Explain this data path and suggest one small experiment. Do not run it yet.” Use text if voice is unavailable. |
| 18-25 | Run the unchanged logistic/basic baseline. | Tests/setup pass, 1,000 validation predictions, baseline evidence preserved. Explain one actual example and its score. |
| 25-30 | New chat > Worktree twice, both from the same personal branch commit. | Different paths/branches, matching inputs, separate output folders and Compose project names. |
| 30-42 | Pipeline: inspect, change 2,048 to 4, measure. While it runs, plan models in the other chat. | One measured change; agree baseline plus two quick model variants before execution. An extra classifier is a stretch choice, not a requirement. |
| 42-60 | When the benchmark finishes, run the agreed model batch. Review the pipeline diff/PR while models run. | No overlapping timed container jobs. Read all benchmark timings and equivalence evidence; inspect the PR base and changes. |
| 60-72 | Explore results, move a threshold, choose the model. | All agreed experiments and unchanged baseline are visible. Record a validation-based choice before any test score. Do not add another experiment loop. |
| 72-80 | Open the model PR in Codex Code Review. Inspect changes and discuss a finding if there is one. | Check evidence and relevant fixes; do not invent a finding for the demonstration. Both PRs target the personal branch. |
| 80-100 | Merge reviewed PRs into the personal branch, return to the original checkout, test, regenerate stale features, compare original values, evaluate the frozen choice. | Tests and feature checks pass. Preserve model-worktree comparison history. Exactly 1,000 held-out test predictions and generated submission JSON. |
| 100-105 | Leaderboard: choose the generated JSON, inspect run/model, submit under the participant account. | Only mark success after acceptance and the persisted result appear. A locally valid JSON is a different checkpoint. |
| 105-120 | Questions, slower runs and closing discussion. | Explain what Codex helped with and which decisions remained human. Mention Cloud as an optional execution path; no live environment provisioning. Sophon remains after-session/early-finisher material. |

## Keep the session moving

- If a team fails setup, pair it with a ready machine. Do not replace its data or weaken network/TLS settings to force progress.
- At minute 30, move to the worktree exercise. At minute 60, stop expanding the model plan. Finish the agreed batch before exploring results.
- Keep Docker computation serial on each machine while measuring. Parallel chats can plan or review without competing for CPU.
- If a model integration exceeds its timebox, use the completed baseline and planned simpler variants. Mark incomplete variants clearly; do not claim they ran.
- If PR access or the native review control fails, review the local diff and record that remote review is still unverified. Do not merge into shared main to save time.
- If the leaderboard is unavailable, validate and retain the generated JSON. Record the upload as pending.
- Saved presenter artifacts are useful for explanation during recovery. Label them as the prior rehearsal; do not present old scores or timings as a fresh participant run.

## Manual rehearsal with the presenter

Use this same agenda and pause at each checkpoint. Keep a simple record: elapsed minute, expected result, observed result, blocker, next action. Review the actual screen before moving on.

1. Verify profile/account and the chosen repository/branch. Start voice only when the presenter is ready; test one spoken question and answer.
2. Open chapter 02, use Open in Codex, and inspect the selected project and complete prompt before sending. Also try Copy and manually paste once. The link does not select an isolated profile for you.
3. Open the prepared checkout through chapter 03; confirm it is reused without an extra nested clone. Check each data filename and readiness result.
4. Follow the timed flow through both worktrees. Verify the actual app copies inputs, rather than inferring that from the existence of `.worktreeinclude`.
5. Open a real PR in Code Review and inspect its latest changes. A review result is not a merge or posted comment.
6. Check integration and leaderboard separately. Keep the selected model frozen. End by recording exactly which native/UI steps passed and which remain open.

Suggested discussion prompts: “Why separate these worktrees?”, “What evidence makes this optimization worth keeping?”, “Would you choose the same model if false positives cost more?”, and “What changed when we moved from validation to test?”
