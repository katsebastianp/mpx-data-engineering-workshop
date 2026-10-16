# Workshop Site

Participant instructions: [ringier-collision-lab.openai.chatgpt.site](https://ringier-collision-lab.openai.chatgpt.site/workshop).

## Local development

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
npm run dev
```

For an existing database, apply only pending migrations. Local sign-in: `/signin-with-chatgpt?return_to=/workshop`. After schema edits, run `npm run db:generate` to create the migration.

Checks: `npm test`, `npm run typecheck`, `npm run build`.

## Edit and publish

- Instructions: `components/workshop-content.ts`. Preserve step IDs so saved progress still works.
- Pages: `components/`; styles: `app/globals.css`; accounts and submissions: `app/api/`, `lib/server/`, `db/`.
- Before publishing, run `python3 scripts/stage_site_sample.py` from the parent repository to stage verified downloads.
- Follow [AGENTS.md](AGENTS.md) and the Sites plugin workflow. Preserve the existing Site, audience and database. Use `.sites-runtime/publish`; keep credentials, local databases and caches out of the source sync.
