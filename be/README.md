# Yoga Sadhana backend

Hono + Drizzle + Postgres. See `../docs/md/backend-architecture.md` for the spine.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the server with tsx watch |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run check` | Run every `src/**/*.test.ts` self-check (Node's built-in test runner + tsx; no test framework). Exits non-zero if any assertion fails. |
| `npx tsc --noEmit` | Typecheck without emitting |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed the database |
| `npm run db:studio` | Drizzle Studio |
