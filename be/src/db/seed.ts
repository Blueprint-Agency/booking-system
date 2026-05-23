// Shim — the real seed pipeline lives under ./seed/run.ts (modular per-feature seeders).
// `npm run db:seed` now points at ./seed/run.ts. This file remains so older docs/scripts
// referencing `src/db/seed.ts` don't 404 — just run the new entry point.
import './seed/run'
