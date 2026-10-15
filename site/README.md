# From particle collisions to better models

A four-page Ringier × OpenAI workshop Site: particle physics, preparation, individual guided exercises, and a durable participant leaderboard.

## Run

Node 22.13+ and npm are required. Run the commands below from `site/`. The participant pipeline in the parent repository still runs in Docker.

```sh
npm ci
npm run db:generate  # only after schema edits
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_clammy_miek.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_motionless_nicolaos.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_wide_cerise.sql
npm run dev
```

Open the printed loopback URL. Local sign-in: `/signin-with-chatgpt?return_to=/workshop`. Apply each migration once per local database (existing previews need only pending migrations). Preview data is separate from hosted data.

## Verify

```sh
npm test
npm run typecheck
npm run build
```

## Application contracts

Participant setup and exercises live only in the rendered Site. `components/workshop-content.ts` owns the step content, dependencies and copyable bullet prompts. Stable step IDs preserve existing progress; the checklist is marked manually, not synchronized with Codex.

The signed-in workspace supplies branch names, Compose prefix and a participant ID stored in the pipeline’s legacy `team` field. Repository URLs are private per-account settings. `GET /api/leaderboard` refreshes every 30 seconds while visible; authenticated same-origin POST accepts JSON up to 1 MB and stores compact verified metrics in D1. The server recomputes quality against fixed IDs without retaining uploaded predictions or email. Validation-only uploads are unranked; replacements belong to the same account. Test-once is a workshop rule, not enforced by the API.

## Files

- `components/WorkshopApp.tsx`, `WorkshopSteps.tsx`, `workshop-content.ts`, `Leaderboard.tsx`: pages and interactions.
- `components/PhysicsJourney.tsx` and `components/ColliderJourneyScene.tsx`: one continuous WebGL camera journey, explicit replayable process animations, reduced motion, and fallback.
- `app/globals.css`: shared responsive visual system.
- `lib/competition.ts`: strict parsing, validation, metric calculations and ranking.
- `lib/server/evaluation.json`: canonical evaluation labels, imported only by the API route.
- `app/api/leaderboard/route.ts`, `db/schema.ts`, `drizzle/`: server identity, persistence and migrations.

## Source and publishing

This `site/` directory is the canonical website source and belongs to the parent `data_eng_ws` Git repository. The live Site is https://ringier-collision-lab.openai.chatgpt.site. Preserve its existing `project_id` and `DB` binding in `.openai/hosting.json` when updating it. Moving this folder does not change the live deployment or its audience.

The Sites publishing helper requires a standalone Git root. For publication, open the existing Site through the Sites plugin in an ignored checkout such as `.sites-runtime/publish`, sync the current `site/` source into that checkout, then build and publish through the plugin. Exclude `.git`, dependencies, caches, local databases, `.sites-runtime`, `.env*`, tool state, and generated output when syncing. Do not initialize `site/.git`, publish the parent repository wholesale, or create a new Site for an update. The previous standalone Site Git history is preserved locally at `.sites-runtime/previous-source.git` and is not part of the parent repository.

`components/SampleDownloads.tsx` links to four versioned static assets under `public/downloads/jetclass2-v1/`. Before publication, run `python3 scripts/stage_site_sample.py` from the parent repository; it validates the local raw files against `config/workshop-sample.lock.json` before staging them. Sync those verified assets into the standalone Site checkout with the source. The parent `.gitignore` excludes them from GitHub; the standalone Sites source and deployment include them. Keep the existing Site audience: browser downloads use the visitor’s Site access. Do not distribute a service token to participants.

The offline comparison viewer is `../tools/results-preview/`; it is available in the Git checkout. The legacy archive builder excludes the authenticated Site source and runtime data. This repository has no GitHub Pages deployment workflow; the authenticated app is deployed through Sites.

For a separate Ringier-owned deployment, export clean source without the existing `project_id`, retain `d1: "DB"` and all migrations, and register a new Site in the intended workspace. Never copy source credentials or runtime data. Verify sharing with actual participant accounts before the session.

Physics scenes are schematic and not to scale. The task is simulated JetClass-II X→bb̄ versus QCD, not a live CERN feed or a physics-discovery claim. The eight feature definitions and commands are grounded in workshop v0.6.

## Blender asset

`assets/collider-v2.blend` is the authored scene; `public/collider-v2.glb` is loaded by the interactive hero. The transparent Blender render is the loading/WebGL fallback. Regenerate with Blender 5.2+:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/render-collider-v2.py
```

Fonts are bundled locally with licenses in `public/fonts/`; there are no runtime font/CDN requests.

## Physics controls

Use **Zoom into the detector** to play two synchronized examples through Collision, Origin, Shower and Jet, or drag the zoom slider to control the camera journey. Pink follows the X → bb signal; blue follows QCD background. Both retain the same trajectories and camera position across steps. Stage buttons seek along the shared timeline; Pause holds it and **Replay full sequence** restarts from collision. Jet reconstruction only adds boundaries around the existing showers. Reduced-motion mode shows a completed schematic; stage buttons select still views. All geometry, distances and times are illustrative.

## Participant accounts and access

- Sites supplies ChatGPT sign-in; no separate passwords or OAuth provider are configured
- `GET /api/progress` returns only the signed-in account’s checklist and repository; anonymous responses contain no personal state
- `PATCH /api/progress` requires authenticated same-origin access and the account shown by the client; per-step writes preserve concurrent changes to other steps
- Progress and leaderboard entries are account-bound; branch names are allocated by `lib/server/participant-workspace.ts`
- User ID is the database ownership key; display name and email come from the current sign-in and are not persisted in progress tables
- Sign-in proves identity; the live Sites audience policy controls who may enter. This is deployment state, not a property of the source.

Local integration check (preserves pre-existing local progress):

```sh
node --import ./scripts/sites-env.mjs --experimental-strip-types tests/progress-http.ts http://127.0.0.1:5177
```
