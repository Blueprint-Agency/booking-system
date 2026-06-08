# Instructor Payroll Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. `be/` has **no test infra** (per project memory) — verify backend with `npx tsc --noEmit` in `be/`, not unit tests. Verify frontend with `npm run typecheck` + `npm run build` in `fe-portal/`.

**Goal:** Let admins record a per-session instructor payment amount (coupled to the main instructor) when scheduling a class or PT session, and add a sortable/filterable Payroll page listing every completed (ended, not cancelled) class + PT session with instructor, duration, date, and amount to pay — editable inline — plus per-instructor totals.

**Architecture:** Store the amount as a nullable `numeric(10,2)` column `instructor_pay_sgd` directly on `classes` and `pt_sessions` (1:1 with the session, coupled to its already-stored `main_instructor_id`/`instructor_id`). Setting it at scheduling or editing it in payroll is the same single `UPDATE`. A new `services/payroll/list.ts` merges the two tables (filtered to `lifecycle='active' AND ends_at < now()`), exposed via `GET/PATCH /portal/admin/payroll`. A new `/admin/payroll` portal page renders the table.

**Tech Stack:** Hono + Drizzle + Postgres (be); Next.js App Router + Tailwind + custom UI kit (fe-portal). Money: `numeric(10,2)` SGD, formatted with `formatSgd()`.

**Scope (v1):** Classes + PT sessions only. Only the main instructor is paid. No workshops, no auto base-rate defaults, no CSV export, no approval/lock workflow.

---

### Task 1: Add `instructor_pay_sgd` column to `classes` and `pt_sessions`

**Files:**
- Modify: `be/src/db/schema/schedule.ts` (`classes` ~line 54, `ptSessions` ~line 416)
- Generated: `be/src/db/migrations/NNNN_*.sql` + snapshot (via `db:generate`)

- [ ] **Step 1: Add column to `classes`** — after the `creditCost` line (line 54), add:

```ts
    creditCost: integer('credit_cost').notNull(),
    // Gross pay to the main instructor for this single class, in SGD. Manually
    // entered at scheduling and editable from the Payroll page. NULL = not priced yet.
    instructorPaySgd: numeric('instructor_pay_sgd', { precision: 10, scale: 2 }),
```

- [ ] **Step 2: Add column to `ptSessions`** — after the `sessionType` line (line 413), add:

```ts
    sessionType: ptSessionTypeEnum('session_type').notNull(),
    // Gross pay to the instructor for this single PT session, in SGD. Same semantics
    // as classes.instructor_pay_sgd. NULL = not priced yet.
    instructorPaySgd: numeric('instructor_pay_sgd', { precision: 10, scale: 2 }),
```

`numeric` is already imported in this file.

- [ ] **Step 3: Generate the migration**

Run (in `be/`): `npm run db:generate`
Expected: a new `NNNN_*.sql` adding two `ALTER TABLE ... ADD COLUMN "instructor_pay_sgd" numeric(10, 2);` statements, plus a matching snapshot. Review the SQL — it must be additive only (no drops/renames).

- [ ] **Step 4: Typecheck** — Run (in `be/`): `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 5: Commit** — `git add be/src/db/schema/schedule.ts be/src/db/migrations` then commit `feat(be): add instructor_pay_sgd to classes and pt_sessions`.

---

### Task 2: Thread pay through the class create/update service + route

**Files:**
- Modify: `be/src/services/schedule/classes.ts`
- Modify: `be/src/routes/portal/admin/schedule.ts`

- [ ] **Step 1: Extend `CreateClassInput`** (classes.ts ~line 52) — add `instructorPaySgd?: number | null` to the interface; add the same to `UpdateClassInput` (~line 114).

- [ ] **Step 2: Insert it in `createClass`** — in the `.values({...})` object add:

```ts
        creditCost: input.creditCost,
        instructorPaySgd:
          input.instructorPaySgd == null ? null : input.instructorPaySgd.toFixed(2),
        createdByStaffId: input.createdByStaffId,
```

- [ ] **Step 3: Set it in `updateClass`** — alongside the other `set.*` assignments:

```ts
    if (patch.instructorPaySgd !== undefined)
      set.instructorPaySgd = patch.instructorPaySgd == null ? null : patch.instructorPaySgd.toFixed(2)
```

- [ ] **Step 4: Route schemas** (schedule.ts) — add to `createClassSchema` object (before the `.refine`s): `instructor_pay_sgd: z.number().min(0).optional(),` and to `updateClassSchema`: `instructor_pay_sgd: z.number().min(0).nullable().optional(),`.

- [ ] **Step 5: Pass to service** — in `POST /classes` handler `createClass({...})` add `instructorPaySgd: body.instructor_pay_sgd ?? null,`. In `PATCH /classes/:id` `updateClass(id, {...})` add `...(body.instructor_pay_sgd !== undefined ? { instructorPaySgd: body.instructor_pay_sgd } : {}),`.

- [ ] **Step 6: Serialize** — in `classRow()` add `instructor_pay_sgd: c.instructorPaySgd == null ? null : Number(c.instructorPaySgd),`.

- [ ] **Step 7: Typecheck** — `npx tsc --noEmit` in `be/` → no errors.

- [ ] **Step 8: Commit** — `feat(be): record instructor pay on class create/update`.

---

### Task 3: Thread pay through PT scheduling

**Files:**
- Modify: `be/src/services/pt-sessions/schedule.ts`
- Modify: `be/src/routes/portal/admin/pt-sessions.ts`

- [ ] **Step 1: Extend input** (schedule.ts `SchedulePtRequestInput` ~line 36) — add `instructorPaySgd?: number | null`.

- [ ] **Step 2: Insert** — in the `tx.insert(ptSessions).values({...})` add `instructorPaySgd: input.instructorPaySgd == null ? null : input.instructorPaySgd.toFixed(2),`.

- [ ] **Step 3: Route schema** (pt-sessions.ts `scheduleSchema` ~line 26) — add `instructor_pay_sgd: z.number().min(0).optional(),` inside the `.object({...})` (before `.refine`).

- [ ] **Step 4: Pass to service** — in `POST /:id/schedule` `schedulePtRequest({...})` add `instructorPaySgd: body.instructor_pay_sgd ?? null,`.

- [ ] **Step 5: Typecheck** — `npx tsc --noEmit` in `be/` → no errors.

- [ ] **Step 6: Commit** — `feat(be): record instructor pay when scheduling PT session`.

---

### Task 4: Payroll service

**Files:**
- Create: `be/src/services/payroll/list.ts`

- [ ] **Step 1: Write the service.** Two selects (classes + pt_sessions), each filtered to completed sessions, merged and sorted by `startsAt` desc in JS. Instructor name joins `staff_users` (PK = `main_instructor_id`/`instructor_id`). Class type name joins `class_types` (PT via its `pt_requests.classTypeId`). Full content:

```ts
import { and, eq, gte, lt, lte } from 'drizzle-orm'
import { db } from '../../db'
import { classes, ptSessions, ptRequests } from '../../db/schema/schedule'
import { classTypes } from '../../db/schema/catalog'
import { staffUsers } from '../../db/schema/identity'

export interface PayrollFilter {
  instructorId?: string
  classTypeId?: string
  from?: Date
  to?: Date
}

export interface PayrollRow {
  kind: 'class' | 'pt'
  id: string
  instructorId: string
  instructorName: string
  classTypeId: string
  label: string
  sessionType: '1on1' | '2on1' | null
  startsAt: Date
  endsAt: Date
  instructorPaySgd: string | null
}

export async function listPayroll(filter: PayrollFilter): Promise<PayrollRow[]> {
  const now = new Date()

  const classConds = [eq(classes.lifecycle, 'active'), lt(classes.endsAt, now)]
  if (filter.instructorId) classConds.push(eq(classes.mainInstructorId, filter.instructorId))
  if (filter.classTypeId) classConds.push(eq(classes.classTypeId, filter.classTypeId))
  if (filter.from) classConds.push(gte(classes.startsAt, filter.from))
  if (filter.to) classConds.push(lte(classes.startsAt, filter.to))

  const classRows = await db
    .select({
      id: classes.id,
      instructorId: classes.mainInstructorId,
      instructorName: staffUsers.name,
      classTypeId: classes.classTypeId,
      label: classTypes.name,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      instructorPaySgd: classes.instructorPaySgd,
    })
    .from(classes)
    .innerJoin(staffUsers, eq(staffUsers.id, classes.mainInstructorId))
    .innerJoin(classTypes, eq(classTypes.id, classes.classTypeId))
    .where(and(...classConds))

  const ptConds = [eq(ptSessions.lifecycle, 'active'), lt(ptSessions.endsAt, now)]
  if (filter.instructorId) ptConds.push(eq(ptSessions.instructorId, filter.instructorId))
  if (filter.classTypeId) ptConds.push(eq(ptRequests.classTypeId, filter.classTypeId))
  if (filter.from) ptConds.push(gte(ptSessions.startsAt, filter.from))
  if (filter.to) ptConds.push(lte(ptSessions.startsAt, filter.to))

  const ptRows = await db
    .select({
      id: ptSessions.id,
      instructorId: ptSessions.instructorId,
      instructorName: staffUsers.name,
      classTypeId: ptRequests.classTypeId,
      label: classTypes.name,
      sessionType: ptSessions.sessionType,
      startsAt: ptSessions.startsAt,
      endsAt: ptSessions.endsAt,
      instructorPaySgd: ptSessions.instructorPaySgd,
    })
    .from(ptSessions)
    .innerJoin(staffUsers, eq(staffUsers.id, ptSessions.instructorId))
    .innerJoin(ptRequests, eq(ptRequests.id, ptSessions.ptRequestId))
    .innerJoin(classTypes, eq(classTypes.id, ptRequests.classTypeId))
    .where(and(...ptConds))

  const rows: PayrollRow[] = [
    ...classRows.map(r => ({ ...r, kind: 'class' as const, sessionType: null })),
    ...ptRows.map(r => ({ ...r, kind: 'pt' as const })),
  ]
  rows.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
  return rows
}

export interface UpdatePayrollResult {
  ok: boolean
}

export async function updatePayrollAmount(
  kind: 'class' | 'pt',
  id: string,
  amount: number | null,
): Promise<UpdatePayrollResult> {
  const value = amount == null ? null : amount.toFixed(2)
  if (kind === 'class') {
    const rows = await db
      .update(classes)
      .set({ instructorPaySgd: value })
      .where(eq(classes.id, id))
      .returning({ id: classes.id })
    return { ok: rows.length > 0 }
  }
  const rows = await db
    .update(ptSessions)
    .set({ instructorPaySgd: value })
    .where(eq(ptSessions.id, id))
    .returning({ id: ptSessions.id })
  return { ok: rows.length > 0 }
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` in `be/` → no errors.

---

### Task 5: Payroll route + mount

**Files:**
- Create: `be/src/routes/portal/admin/payroll.ts`
- Modify: `be/src/routes/portal/admin/index.ts`

- [ ] **Step 1: Write the route.** GET returns rows + per-instructor totals (computed from priced rows) + an `unpriced_count`. PATCH updates one row.

```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { listPayroll, updatePayrollAmount, type PayrollRow } from '../../../services/payroll/list'

const isoDate = z.string().refine(v => !Number.isNaN(Date.parse(v)), { message: 'invalid iso datetime' })

const listQuery = z.object({
  instructor_id: z.string().uuid().optional(),
  class_type_id: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
})

const patchParam = z.object({ kind: z.enum(['class', 'pt']), id: z.string().uuid() })
const patchBody = z.object({ instructor_pay_sgd: z.number().min(0).nullable() })

function serialize(r: PayrollRow) {
  return {
    kind: r.kind,
    id: r.id,
    instructor_id: r.instructorId,
    instructor_name: r.instructorName,
    class_type_id: r.classTypeId,
    label: r.label,
    session_type: r.sessionType,
    starts_at: r.startsAt.toISOString(),
    ends_at: r.endsAt.toISOString(),
    duration_minutes: Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / 60000),
    instructor_pay_sgd: r.instructorPaySgd == null ? null : Number(r.instructorPaySgd),
  }
}

const app = new Hono()
  .get('/', zValidator('query', listQuery), async c => {
    const q = c.req.valid('query')
    const rows = await listPayroll({
      instructorId: q.instructor_id,
      classTypeId: q.class_type_id,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    })
    const totalsMap = new Map<string, { instructor_id: string; instructor_name: string; total_sgd: number; session_count: number }>()
    let unpricedCount = 0
    for (const r of rows) {
      const t = totalsMap.get(r.instructorId) ?? {
        instructor_id: r.instructorId,
        instructor_name: r.instructorName,
        total_sgd: 0,
        session_count: 0,
      }
      t.session_count += 1
      if (r.instructorPaySgd == null) unpricedCount += 1
      else t.total_sgd += Number(r.instructorPaySgd)
      totalsMap.set(r.instructorId, t)
    }
    const totals = Array.from(totalsMap.values()).sort((a, b) =>
      a.instructor_name.localeCompare(b.instructor_name),
    )
    return c.json({ rows: rows.map(serialize), totals, unpriced_count: unpricedCount })
  })
  .patch('/:kind/:id', zValidator('param', patchParam), zValidator('json', patchBody), async c => {
    const { kind, id } = c.req.valid('param')
    const { instructor_pay_sgd } = c.req.valid('json')
    const res = await updatePayrollAmount(kind, id, instructor_pay_sgd)
    if (!res.ok) return c.json({ error: 'not_found' }, 404)
    c.set('auditTarget' as any, { table: kind === 'class' ? 'classes' : 'pt_sessions', id })
    return c.json({ ok: true })
  })

export default app
```

- [ ] **Step 2: Mount + gate** in `index.ts`: add import `import payroll from './payroll'`; add gate under the shared block `.use('/payroll/*', staffAny)`; add mount `.route('/payroll', payroll)`.

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` in `be/` → no errors.

- [ ] **Step 4: Commit** — `feat(be): payroll listing + inline pay edit endpoints`.

---

### Task 6: Portal nav — add Finance → Payroll

**Files:**
- Modify: `fe-portal/src/components/layout/nav-items.ts`

- [ ] **Step 1: Import an icon** — add `Wallet` to the `lucide-react` import block.

- [ ] **Step 2: Extend the group type** — change `NavGroup` to include `"Finance"`:
`export type NavGroup = "Config" | "Packages" | "Corporate" | "People" | "Finance" | "Settings";`

- [ ] **Step 3: Add the item** — after the People group entries, add (NB `scope: "both"` so non-superadmin admins can see it — the nav role filter only shows `workspace`/`both` items to admins):
`{ group: "Finance", label: "Payroll", href: "/admin/payroll", icon: Wallet, scope: "both" },`

- [ ] **Step 4: Add to order** — `export const NAV_GROUP_ORDER: NavGroup[] = ["Config", "Packages", "Corporate", "People", "Finance", "Settings"];`

---

### Task 7: Portal Payroll page

**Files:**
- Create: `fe-portal/src/lib/payroll.ts`
- Create: `fe-portal/src/app/admin/payroll/page.tsx`

- [ ] **Step 1: Types lib** (`lib/payroll.ts`):

```ts
export interface ApiPayrollRow {
  kind: "class" | "pt";
  id: string;
  instructor_id: string;
  instructor_name: string;
  class_type_id: string;
  label: string;
  session_type: "1on1" | "2on1" | null;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  instructor_pay_sgd: number | null;
}

export interface ApiPayrollTotal {
  instructor_id: string;
  instructor_name: string;
  total_sgd: number;
  session_count: number;
}

export interface ApiPayrollResponse {
  rows: ApiPayrollRow[];
  totals: ApiPayrollTotal[];
  unpriced_count: number;
}

export type PayrollSortKey = "instructor" | "label" | "date" | "duration" | "amount";
```

- [ ] **Step 2: Page** (`app/admin/payroll/page.tsx`). Client component. Loads instructors + class types for filter dropdowns, fetches `/portal/admin/payroll` with filters, renders a `<table>` with clickable sortable headers (client-side sort), an inline-editable amount cell (PATCH on blur), a totals summary, and an unpriced-count notice. Uses `formatSgd`, `formatDate`, `formatDuration`, `PageHeader`, `EmptyState`, `Input`, lucide `ArrowUp`/`ArrowDown`/`ArrowUpDown`, and `sonner` toast. Full content is in the implementation (matches the existing portal table/list idiom: `border border-border bg-card`, `text-muted`, accent rings). Filters sent: `instructor_id`, `class_type_id`, `from`, `to` (month picker → first/last day ISO). Month filter default: current month.

- [ ] **Step 3: Typecheck + build** — in `fe-portal/`: `npm run typecheck` then `npm run build` → both succeed.

- [ ] **Step 4: Commit** — `feat(fe-portal): payroll page with sortable table, filters, inline pay edit`.

---

### Task 8: Pay input on the two scheduling surfaces

**Files:**
- Modify: `fe-portal/src/app/admin/schedule/new/class/page.tsx`
- Modify: `fe-portal/src/components/pt-requests/schedule-from-request-dialog.tsx`

- [ ] **Step 1: Class form** — add `const [instructorPay, setInstructorPay] = useState("");` state; add an optional "Instructor pay (S$)" number input in the "Capacity & price" section after Credit cost; in the POST body add `instructor_pay_sgd: instructorPay.trim() === "" ? undefined : Number(instructorPay),`.

- [ ] **Step 2: PT dialog** — add `const [instructorPay, setInstructorPay] = useState("");`; add an optional "Instructor pay (S$)" input in the grid; in the POST body add `instructor_pay_sgd: instructorPay.trim() === "" ? undefined : Number(instructorPay),`.

- [ ] **Step 3: Typecheck + build** — `npm run typecheck` + `npm run build` in `fe-portal/` → succeed.

- [ ] **Step 4: Commit** — `feat(fe-portal): capture instructor pay when scheduling class/PT`.

---

### Task 9: Docs

**Files:**
- Modify: `docs/md/be-portal.md`

- [ ] **Step 1:** Add a short "Payroll" subsection documenting `GET /portal/admin/payroll` (filters, response shape, completed = `lifecycle='active' AND ends_at < now()`) and `PATCH /portal/admin/payroll/:kind/:id`, plus the new `instructor_pay_sgd` field on class/PT scheduling. Commit `docs: document payroll endpoints`.
