.PHONY: dev start urls install build studio init reset generate up down migrate ensure-db seed

dev: urls
	(cd fe-client && npm run dev) & \
	(cd fe-portal && npm run dev) & \
	(cd be && npm run dev) & \
	wait

# Serve the frontends' production builds. Run `make build` first — `next start`
# needs `.next/` to exist. The backend runs its sources under tsx here and in
# production alike (see be/Dockerfile); there is no compiled backend to serve.
start: ensure-db urls
	(cd fe-client && npm run start) & \
	(cd fe-portal && npm run start) & \
	(cd be && npm run start) & \
	wait

# Next prints `http://localhost:3000` and `:3001`, which is where nothing is: a
# Tenant is read from the subdomain, and the bare host names none. These are the
# hosts that actually resolve. No studio is named because a fresh platform has
# none — the super portal is where the first one is created.
#
# The `&&` chain is load-bearing on Windows: GNU Make runs a simple recipe line
# through CreateProcess directly, and `echo` there is a cmd builtin rather than
# an executable, so a bare `@echo` fails with "cannot find the file specified".
# An operator in the line forces Make through the shell, where echo exists —
# which is also why every other recipe in this file happens to work.
urls:
	@echo '' && \
	echo '  Super portal   http://admin.portal.localhost:3001   <- start here' && \
	echo '  Staff portal   http://<slug>.portal.localhost:3001' && \
	echo '  Client         http://<slug>.localhost:3000' && \
	echo '  API            http://localhost:4000' && \
	echo '' && \
	echo '  <slug> is a studio created from the super portal. Bare' && \
	echo '  localhost:3000 / :3001 resolve no Tenant and will 404.' && \
	echo ''

install:
	(cd fe-client && npm install) & \
	(cd fe-portal && npm install) & \
	(cd be && npm install) & \
	wait

build:
	(cd fe-client && npm run build) & \
	(cd fe-portal && npm run build) & \
	(cd be && npm run build) & \
	wait

studio:
	cd be && npm run db:studio

# Fresh machine to runnable, in order: dependencies first (migrate and seed run
# through the backend's node_modules), then the database, then the build.
#
# The steps are the recipe, not prerequisites, so `make -j` cannot reorder them.
# They are spelled out rather than calling $(MAKE): GnuWin32 make lives under
# `Program Files (x86)`, and a recursive call through that path fails on Windows.
# Keep them in step with `install`, `ensure-db`, `migrate`, `seed` and `build`.
init:
	(cd fe-client && npm install) & \
	(cd fe-portal && npm install) & \
	(cd be && npm install) & \
	wait
	docker compose --env-file be/.env up -d --wait
	docker exec reservetoday-db createdb -U postgres reservetoday 2>/dev/null || true
	cd be && npm run db:migrate
	cd be && npm run db:seed
	(cd fe-client && npm run build) & \
	(cd fe-portal && npm run build) & \
	(cd be && npm run build) & \
	wait

# Bring up Postgres and ensure the reservetoday database exists.
# Postgres auto-creates POSTGRES_DB on first volume init only; for an existing
# volume we explicitly createdb (idempotent — swallows "already exists" error).
#
# The compose project, container, volume and database are all `reservetoday`,
# so every worktree shares one stack instead of each fighting for the same
# container name. Renaming the volume means Docker mounts a new, empty one: a
# machine that had the old names needs `make reset` (which drops the old
# volume) then `make init`. Local scratch data only — the seed creates no
# studios, so nothing here is anyone's records.
ensure-db:
	docker compose --env-file be/.env up -d --wait
	docker exec reservetoday-db createdb -U postgres reservetoday 2>/dev/null || true

reset:
	docker compose --env-file be/.env down -v

migrate:
	cd be && npm run db:migrate

generate:
	cd be && npm run db:generate

seed:
	cd be && npm run db:seed

up:
	docker compose --env-file be/.env up -d

down:
	docker compose --env-file be/.env down
