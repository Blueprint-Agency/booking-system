# Admin schedules a class

A studio admin creates a one-off class in the staff portal: class type, main instructor and pay, room, date and time. The admin lands back on the schedule, and the instructor sees the class on My schedule.

## Sub-features

- `class-new` opens the New class form.
- `class-create` saves a class with type, instructor, pay, room, date, start and end.
- `class-on-admin-schedule` lists it on the admin schedule.
- `class-on-instructor-schedule` lists it on the instructor's My schedule with its time.

## How to get to it (user POV)

- Staff portal › sign in as admin › **Schedule** › new class (`/admin/schedule/new/class`).
- Staff portal › sign in as instructor › **My schedule** (`/instructor/schedule`).

## Driving it with verify-booking-system

Preconditions:

- Doctor passes. `catalogue.portalClassType` has nothing scheduled. The room `E2E Room` exists. `studio.staff.instructor.name` teaches that type.

- **Sign in as admin.** `signInStaff(page, studio.staff.admin)`, then `page.waitForURL(/\/admin/)`.
- **Open the form.** `goto(urls.portal + '/admin/schedule/new/class')`. The heading `New class` shows.
- **Fill and create.** Using `getByLabel(label, { exact: true })`: `Class type` select `catalogue.portalClassType`; `Main instructor` select `staff.instructor.name`; `Main instructor pay (S$) · optional` `50`; `Room` select `E2E Room`; `Date` a date eight days ahead as `YYYY-MM-DD` on the studio's clock (the e2e studio is on Australia/Sydney; read it from the slug lookup, as `studioTimezone` in `e2e/src/studio.ts` does); `Start time` `10:00`; `End time` `11:00`. Click `Create class`. The URL becomes `/admin/schedule`.
- **Instructor sees it.** In `await newPage()`, `signInStaff(p2, studio.staff.instructor)`, `waitForURL(/\/instructor\/schedule/)`. The heading `My schedule` shows, with `catalogue.portalClassType` and a time matching `10:00 … –`.
- **Proof.** `shot` the admin schedule and the instructor's schedule; `sql` `select c.id, c.starts_at, c.instructor_id from classes c join class_types t on t.id = c.class_type_id where c.tenant_id = '<tenantId>' and t.name = '<portalClassType>'` (one row, `starts_at` 10:00 on the studio's clock on that date: 00:00 UTC that day in Sydney's winter, 23:00 UTC the day before in its summer), plus `audit_log` rows for the create.

## Gotchas

- This recipe comes from the CI journey `e2e/journeys/schedule-a-class.spec.ts` and has not yet been run through this skill. Check the `classes` and `class_types` column names with `stack.mjs sql "\d classes"` before trusting the query above.
- The e2e studio is on Australia/Sydney and every date and time is read on the studio's clock, so the time typed is the time the instructor and a member read back whatever zone the browser runs in. The CI journey puts the browser in America/Los_Angeles to prove it.
- Run admin and instructor in separate contexts (`newPage()`): both sessions live in the same portal origin's storage.
