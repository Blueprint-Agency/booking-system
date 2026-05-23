# Rooms building block + scheduler clash validation

Date: 2026-05-20
Status: approved

## Goal

Add a new location-scoped building block — **rooms** (physical spaces, each with a
name + capacity) — that admins manage per location, and require a room when
scheduling a class, workshop day, or PT session. Validate at schedule time that the
same room is never double-booked across overlapping times.

## Decisions (locked)

- **Physical room model**: each `rooms` row is one physical space; a room hosts one
  session at a time.
- **Required**: picking a room is required for every new schedule/reschedule
  (enforced at the app layer; see nullable-column note below).
- **Hard block** on clash: reject create/reschedule with a 409 naming the conflict.
- **Cross-type clash**: a room clash is checked across `classes`, `workshop_days`,
  and `pt_sessions` together — a physical room can't host two things at once.
- **Room capacity is decoupled** from booking capacity (online/waitlist/buffer). Room
  capacity is informational metadata only; it does NOT cap session capacity.
- **fe-client untouched** — rooms are an internal scheduling concern.

## Data model

New table `rooms` in `be/src/db/schema/catalog.ts`:

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `location_id` | uuid FK → locations | `onDelete: restrict`, notNull |
| `name` | text | notNull |
| `capacity` | integer | notNull, CHECK `> 0` |
| `archived_at` | timestamp(tz) | soft delete |

Indexes:
- `rooms_location_archived_idx` on `(location_id, archived_at)`
- `rooms_location_name_lower_unique` unique on `(location_id, lower(name))`

Add **nullable** `room_id` uuid FK → rooms (`onDelete: restrict`) to:
- `classes`
- `workshop_days`
- `pt_sessions`

Nullable at the DB level so existing rows need no backfill; **required at the app
layer** (zod schemas + frontend forms) for every new create/reschedule. Add a
`(room_id, starts_at)` index on each for the clash lookup.

One generated migration: `be/src/db/migrations/0002_*.sql` (via `npm run db:generate`).

## Clash validation

New shared service `be/src/services/schedule/room-conflicts.ts`:

```
assertRoomAvailable(roomId, startsAt, endsAt, {
  excludeClassId?, excludeWorkshopDayId?, excludePtSessionId?
}): Promise<void>
```

- Queries `classes`, `workshop_days`, `pt_sessions` for **active** (non-cancelled;
  workshop_days inherit their parent workshop's lifecycle) rows in `roomId` where
  `startsAt < existing.endsAt AND endsAt > existing.startsAt`.
- Excludes the row being rescheduled via the `exclude*` params.
- On overlap → `ConflictError('room_clash', { conflicts: [{ kind, id, starts_at, ends_at }] })`.

Also a helper `assertRoomInLocation(roomId, locationId)` → `BadRequestError('room_location_mismatch')`
when the chosen room does not belong to the session's location (and `NotFoundError`
if the room is missing/archived).

Called from:
- `services/schedule/classes.ts` → `createClass`
- `services/workshops/days.ts` → `createDay`, `updateDay` (when time or room changes)
- `services/pt-sessions/approve.ts` → wired into the (currently stubbed) approve path
  so it's correct once that endpoint is implemented.

## Backend CRUD

`be/src/services/catalog/rooms.ts`:
- `listRooms({ locationId?, includeArchived })`
- `getRoom(id)`
- `createRoom({ location_id, name, capacity })` — validates location exists/active
- `updateRoom(id, patch)`
- `archiveRoom(id)` — blocked if referenced by a future active class / workshop day /
  PT session (mirrors `class-types` archive guard) → `ConflictError('room_in_use', …)`
- `unarchiveRoom(id)`

`be/src/routes/portal/admin/rooms.ts`:
- `GET /` (`?location_id=`, `?include_archived=`)
- `GET /:id`
- `POST /`
- `PATCH /:id`
- `POST /:id/archive`
- `POST /:id/unarchive`

Mounted as `.route('/rooms', rooms)` in `be/src/routes/portal/admin/index.ts`.
Audit target `{ table: 'rooms', id }` set on writes (matches existing pattern).

Zod: add `room_id: z.string().uuid()` to `createClassSchema` (schedule.ts),
`dayCreateSchema` + `dayUpdateSchema` (workshops.ts), and the PT approve schema.

Seed: add 2 rooms per location in `be/src/db/seed/*` so forms have options.

## fe-portal UI

- New `/admin/rooms` section mirroring the locations management page: list grouped by
  location, create/edit/archive form, nav entry beside the other building blocks.
- Location-filtered **Room** dropdown added to: new-class form
  (`schedule/new/class/page.tsx`), the workshop-day form, and the PT approve/schedule
  form. The dropdown reloads when the selected location changes.
- Surface the 409 `room_clash` (and `room_location_mismatch`) errors inline on submit.

## fe-client

No change.

## Docs

- `docs/md/backend-architecture.md` — add `rooms` to schema, `room_id` on schedule tables.
- `docs/md/be-portal.md` — document the `/portal/admin/rooms` routes + clash 409s.
- `docs/md/admin-restructure.md` — rooms as a building block.

## Env

No new env vars. No change to `deploy-be.yml`.

## Out of scope

- Room capacity capping booking capacity.
- Per-room availability calendars / room-specific opening hours.
- Client-facing room display.
