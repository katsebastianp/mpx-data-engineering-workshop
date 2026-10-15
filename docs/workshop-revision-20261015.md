# Workshop revision · 15 October 2026

This revision responds to the first participant E2E rehearsal: less prompt copying, more visible data and participant decisions, fewer default runs. A follow-up simplified the visible steps: short actions and visuals, with explanations and checks collapsed under More context. The 90-minute core is a facilitation target, not a measured participant completion time.

## Review the changes

- Steps 01–03: explicit GitHub plugin, repository/version link, terminal fallback, pushed personal branch; explain the participant ID once.
- Step 04: new chat, a small interactive HTML code/data tour grounded in a checked-in real example, committed and pushed. The Site itself also provides a clickable real-jet flow.
- Steps 05–06: two default classifiers, optional Sophon download, visible next-step flow, worktree explanation and manual-checklist semantics.
- Steps 07–09: predict the effect of one Spark setting, inspect the diff, compare every output value and recorded tasks/time, create PR, participant-operated review.
- Steps 10–12: side chat for model ideas, Plan mode for an agreed hypothesis and at most two configurations, participant chooses the model, Codex opens its PR, participant reviews.
- Steps 13–14: participant merges in the app, verifies GitHub and pulls; check the combined result without tuning against test results.
- Step 15: participant chooses the audience/story/design for one small results page. Keep the threshold slider and whole-validation confusion matrix; supply the offline viewer as a quick fallback.
- Former mandatory step 16 and leaderboard upload are outside the core flow as optional extensions. Existing progress and leaderboard records are preserved.

## Reversibility

Code baseline: `4176e4c`, tagged `workshop-before-e2e-redesign-20261015`.
Revision branch: `workshop/e2e-redesign-20261015`. Shared `main` is unchanged. Participant instructions clone this revision explicitly, so they receive the matching setup flag, two-model defaults and comparison helper. Existing participant test checkouts were not modified.

To return to the previous source, first preserve any new uncommitted work, then switch to `main` or create a new branch from the backup tag. Do not reset or delete the revision branch: it retains the changes for selective reuse.

Site rollback target: **version 14**, `appgprj_6acd0d5f35d8819180243ccbf84c5b86~appgver_ab7658253e508191b145e29f339a85ff`.
Project: `appgprj_6acd0d5f35d8819180243ccbf84c5b86`. The prior archive is saved, so use the Sites deployment tool to redeploy that version. Preserve the current custom audience. No database schema, account, progress, leaderboard or access-policy changes are part of this revision.

If adopted, promote the source through the normal Git review flow and change `WORKSHOP_SOURCE_BRANCH` in `site/components/workshop-content.ts` to the agreed source branch before republishing. Until then, the live revision and its explicit source branch stay aligned.

## Verification

The isolated ARM64 Docker run used the existing `particle-workshop:0.6.0` image with 2 CPUs / 2 GiB, fixed sample and seed 42. Both default models produced 1,000 validation scores. The one-setting experiment preserved every saved value across all 6,000 jets; scheduled tasks fell from 68 to 8. Observed preprocessing times were 7.93s and 7.45s, a small single-run difference, not a speed guarantee. Core setup/checks, preparation, two fits and export took 10.10s excluding the full test suite, image build, downloads and Codex latency.

Commands: `docker compose run --rm lab -m pytest -q`; in `site/`, `npm test`, `npm run typecheck`, `npm run build`. Local browser checks cover the real-row stages, threshold decision, new workshop sequence and optional extensions. Runtime evidence is retained locally under ignored `evidence/core-redesign-20261015/`.

The complete participant journey on their available Codex model, fresh image build, native worktree/Review PR/merge controls and physical Windows/8-GB laptop timing still need a rehearsal. The short prompts reduce scope; they do not establish a measured agent-latency improvement.
