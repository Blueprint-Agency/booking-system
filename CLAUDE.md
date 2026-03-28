# Teeko Booking System

Multi-tenant SaaS booking & management platform. Monorepo with two independent apps.

## Project Structure

```
booking-system/
├── fe/          # Frontend (not yet scaffolded)
├── be/          # Backend (not yet scaffolded)
├── docs/
│   ├── html/    # Static HTML docs (deployed to Vercel)
│   └── md/      # Markdown source docs
└── vercel.json  # Deploys docs/html/ as static site
```

## Current Phase

**Frontend mockup** — building a clickable prototype with no backend. Static HTML files deployed via Vercel.

- PRD: `docs/md/prd-phase1.md`
- Frontend spec: `docs/md/frontend-design.md`

## Apps

### `fe/` — Frontend
- Not yet scaffolded. Will be Next.js App Router + Tailwind + shadcn/ui.
- Runs independently from backend.

### `be/` — Backend
- Not yet scaffolded. Tech stack TBD.
- Runs independently from frontend.

## Deployment

- **Docs site**: Vercel static deploy from `docs/html/` (current `vercel.json`)
- No build command — pure static HTML files.

## Design Tokens

The warm minimal design system is defined in `docs/md/frontend-design.md` §2 and previewed in `docs/html/index.html`. Fonts: DM Serif Display, Outfit, JetBrains Mono. Palette: cream/terracotta/sage.

## Conventions

- Keep `fe/` and `be/` fully decoupled — no shared dependencies between them.
- Docs go in `docs/md/` (markdown source) or `docs/html/` (rendered/static).
- Do not commit `.env` files or secrets.
