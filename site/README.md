# Workshop Site

Participant instructions: [ringier-collision-lab.openai.chatgpt.site](https://ringier-collision-lab.openai.chatgpt.site/workshop).

## Run the participant guide locally

Use the workshop branch `codex/workshop-readiness-20261019` until the
facilitator confirms it has been merged. Keep this branch available while the
hosted prompts point to it.

```sh
git clone -b codex/workshop-readiness-20261019 https://github.com/RingierIMU/mpx-data-engineering-workshop.git
cd mpx-data-engineering-workshop/site
```

If you already have a checkout, ask Codex to verify its branch and preserve
your changes instead of cloning over it. On Windows, run these commands in
WSL 2 with Node and your approved container runtime available there.

From `site/`, with Node 22.13+ and npm:

```sh
npm ci
npm run build
```

For a fresh local database, apply all migrations:

```sh
for migration in drizzle/*.sql; do
  node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file "$migration"
done
npm run dev -- --hostname 127.0.0.1 --port 8789
```

Open **http://127.0.0.1:8789/brief**, then choose Instructions. The local
development server uses its own simulated sign-in and local database.
If prompted, use http://127.0.0.1:8789/signin-with-chatgpt?return_to=/workshop.
Create a fresh run with your own unique name before starting.

Local progress and leaderboard results stay on this laptop. They do not publish
to the shared hosted leaderboard. If hosted access is unavailable, give the
facilitator the generated final JSON from `data/04_submissions/`.

Get the four pinned sample files from the facilitator before arrival and place
them in the repository's `data/01_raw/`. A Git clone does not include the sample
downloads. Use the readiness prompt in the brief to verify the files and the
container build/setup/tests. Node is needed for this local guide; Python and
Java for the lab run inside the container.

For an existing database, apply only pending migrations. Do not rerun the full
fresh-database loop over an existing rehearsal database, or delete it to fix an
error. Keep the local server bound to `127.0.0.1`.

## Local development

After schema edits, run `npm run db:generate` to create the migration.

Checks: `npm test`, `npm run typecheck`, `npm run build`.

## Edit and publish

- Instructions: `components/workshop-content.ts`. Preserve step IDs so saved progress still works.
- Pages: `components/`; styles: `app/globals.css`; accounts and submissions: `app/api/`, `lib/server/`, `db/`.
- Before publishing, run `python3 scripts/stage_site_sample.py` from the parent repository to stage verified downloads.
- Follow [AGENTS.md](AGENTS.md) and the Sites plugin workflow. Preserve the existing Site, audience and database. Use `.sites-runtime/publish`; keep credentials, local databases and caches out of the source sync.
