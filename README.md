# Yoga Sadhana Booking System

Dedicated booking and management platform for **Yoga Sadhana** — two studio locations: Breadtalk IHQ (Tai Seng) and Outram Park.

## Apps

| App | Stack | Port | Purpose |
|---|---|---|---|
| `fe-client/` | Next.js | 3000 | Member-facing booking app |
| `fe-portal/` | Next.js | 3001 | Staff app — admin + instructor views |
| `be/` | Hono + Drizzle + Postgres | 4000 | Backend API |

## Prerequisites

- Node.js 20+
- Docker (for local Postgres)
- `make` (via WSL or Git Bash on Windows)

## Getting Started

```bash
# 1. Install dependencies for all apps
make install

# 2. Copy and fill in environment variables
cp be/.env.example be/.env

# 3. Start the Postgres container
make up

# 4. Run migrations and seed the database
make init

# 5. Start all apps in dev mode
make dev
```

## Make Commands

### Development

| Command | Description |
|---|---|
| `make dev` | Start all 3 apps in dev mode (parallel) |
| `make install` | Install dependencies for all 3 apps (parallel) |
| `make build` | Build all 3 apps (parallel) |

### Database

| Command | Description |
|---|---|
| `make up` | Start the Postgres Docker container |
| `make down` | Stop the Postgres Docker container (keeps data) |
| `make init` | Start DB, run migrations, and seed |
| `make reset` | Stop DB and destroy all data (volume removed) |
| `make generate` | Generate Drizzle migration files from schema changes |
| `make studio` | Open Drizzle Studio (browser DB viewer) |

## Project Structure

```
booking-system/
├── fe-client/       # Member-facing booking app (Next.js)
├── fe-portal/       # Staff app — admin + instructor views (Next.js)
├── be/              # Backend — Hono + Drizzle + Postgres
├── docs/
│   ├── md/          # Markdown specs (canonical source of truth)
│   └── html/        # Static HTML mockups
├── docker-compose.yml
└── Makefile
```

## Docs

Canonical specs live in `docs/md/`:

| File | What it covers |
|---|---|
| `prd.md` | Overall product requirements |
| `fe-client-features.md` | Client app behaviour and user journeys |
| `admin-restructure.md` | Staff/portal app behaviour |
| `backend-architecture.md` | Backend stack, DB schema, integrations |
| `be-portal.md` | Portal backend routes and endpoints |
| `be-client.md` | Client backend routes and endpoints |
