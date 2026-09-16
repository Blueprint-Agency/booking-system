.PHONY: dev start install build studio init reset generate up down migrate ensure-db seed

dev:
	(cd fe-client && npm run dev) & \
	(cd fe-portal && npm run dev) & \
	(cd be && npm run dev) & \
	wait

# Serve the production builds. Run `make build` first — each app's `start`
# runs compiled output, not sources.
start: ensure-db
	(cd fe-client && npm run start) & \
	(cd fe-portal && npm run start) & \
	(cd be && npm run start) & \
	wait

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

init: ensure-db
	cd be && npm run db:migrate
	cd be && npm run db:seed

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
