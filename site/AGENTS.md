# Workshop Site source

- `site/` is canonical source inside the parent `data_eng_ws` repository; do not create a nested `.git` here
- Preserve the existing Site identity and `DB` binding in `.openai/hosting.json` for updates
- Native Sites publication needs a standalone source checkout: use an ignored `.sites-runtime/publish` checkout opened through the Sites plugin, sync only the canonical Site source there, and publish that checkout
- Never sync dependencies, local databases, `.env*`, Git metadata, `.sites-runtime`, or tool caches as source
- The sibling `tools/model-explorer/` is the offline participant viewer, not the authenticated workshop Site
- Apply all pending `drizzle/` migrations for a fresh local database; see README.md for run and verification commands
