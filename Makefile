.PHONY: dev install build studio init reset generate up down migrate ensure-db seed

dev:
	(cd fe-client && npm run dev) & \
	(cd fe-portal && npm run dev) & \
	(cd be && npm run dev) & \
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
	cd be && npm run db:generate
	cd be && npm run db:migrate
	cd be && npm run db:seed

# Bring up Postgres and ensure the yoga-sadhana database exists.
# Postgres auto-creates POSTGRES_DB on first volume init only; for an existing
# volume we explicitly createdb (idempotent — swallows "already exists" error).
ensure-db:
	docker compose --env-file be/.env up -d --wait
	docker exec yoga-sadhana-db createdb -U postgres yoga-sadhana 2>/dev/null || true

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
