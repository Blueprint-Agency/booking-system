# Research — capturing "these two must not be away together"

> Research note, not a spec and not a plan. No implementation is proposed; the two
> recommended options are costed, not designed.
>
> `docs/` has no prior research/notes convention — it holds `md/` (specs), `plans/`,
> `audits/`, `superpowers/` and `agents/`. This takes the name the brief suggested:
> `docs/md/research-cover-group-ux.md`.
>
> Sourcing note: a few vendor help centres (Deputy, Humanity, Keka, 7shifts) return
> 403 to direct fetches, so those quotes come from the search index of the vendors' own
> pages or their public API JSON — primary content, indirect retrieval. Anything marked
> **SECONDARY** was not verifiable at first hand.

## The question

Global Policy today has a **Cover Group**: one flat, studio-wide ticked set of instructors,
plus a numeric **Cover Group cap** — the most of that set who may be away at one instant.
The admin's actual goal is more specific: *say which instructor may not have overlapping
leave with which other instructor*. That is a pairwise (or small-clique) mutual-exclusion
constraint, not one global set and a count.

---

## What the current model expresses

**Storage — two columns, no join table.**

- `instructors.in_cover_group boolean NOT NULL DEFAULT false`
  — `be/src/db/schema/catalog.ts:105`, added in `be/src/db/migrations/0020_leave_caps_and_cover_group.sql:3`.
- `global_policy.cover_group_leave_cap integer NOT NULL DEFAULT 1`, with a `>= 1` check
  — `be/src/db/schema/policy.ts:29` and `:47`; migration lines 1 and 4.

The whole model is *one set, one number.*

**The rule.** `leaveCapExceedance` (`be/src/services/leave/rules.ts:548`) builds at most two
counted sets: if the **applicant** is in the Cover Group, the peers also in it against
`coverGroupCap` (`rules.ts:550-552`); and for a `study` request, everyone's study leave
against `studyCap` (`rules.ts:553-555`). It takes the **peak** number away at any single
instant in the window (`peakLeaveAway`, `rules.ts:464`), counts the applicant, and exceeds
if `away + 1 > cap` (`rules.ts:560`). Medical is never refused (`rules.ts:515`) but still
counts for everyone else.

**The refusal names people, never a reason** (`rules.ts:521-528`):

> "Alice and Cara are already on leave on 18 Aug 2026. At most 2 instructors can be away at once."

**The admin control.** `fe-portal/src/app/admin/policy/page.tsx` — two number inputs
(~lines 387-407) and a scrolling list of bare `<input type="checkbox">` in `<label>`s, one
per active instructor, with a count line (~lines 417-460). No `role`/`aria-*` beyond one
`role="alert"` (line 413), and no `fieldset`/`legend` around the list.

**The wire and the write.** One array, `cover_group_staff_ids`
(`be/src/routes/portal/admin/policy.ts:47`); `updateGlobalPolicy` replaces it wholesale in a
transaction — lock every instructor row in `staff_user_id` order, set all false, set the
arriving ids true (`be/src/services/policy/update.ts:51-80`). That ordering exists because
submission takes the same lock (`be/src/services/leave/requests.ts:487-496`).

### What it can express

- "At most K of this one hand-picked set away at any instant" — including K = 1, which *is*
  "no two of these people overlap."
- A half-day-accurate peak over instants rather than a naive overlap headcount
  (`rules.ts:464-478`; rationale in `docs/md/spec-pre-launch-batch.md` §17).
- Inertness by default (`spec-pre-launch-batch.md:194`, story 110).

### What it cannot express

1. **Any single pair.** Alice-never-with-Bob while Alice-with-Cara is fine is unrepresentable.
   Tick all three at cap 1 and you have also banned Bob+Cara; at cap 2 you have allowed Alice+Bob.
2. **More than one group.** One boolean, so the Tai Seng cover team and the Outram Park cover
   team cannot have separate caps — and two locations is the studio's actual shape (`CLAUDE.md`).
3. **Overlapping membership.** An instructor is in at most one cover set.
4. **Anything asymmetric, per-type or date-bounded.**
5. **Per-group caps.** One integer for the one set.

This was a deliberate cut, not an oversight — `docs/md/spec-pre-launch-batch.md` §17:

> "A table of named groups was rejected: it is a second concept — name it, CRUD it, decide
> what membership of two groups means — bought for a requirement nobody stated."

The same section rejects *harder* deriving cover from `instructor_class_types`
(`be/src/db/schema/catalog.ts:108`), because it makes an invisible leave rule out of a
scheduling table. **The requirement has now been stated, which reopens the first rejection.
The second should stay rejected.**

---

## What real products do

17 vendors checked. The headline: **no mainstream scheduling/HR product exposes a true
pairwise "A cannot overlap with B" constraint.** The market converged on four shapes —
scoped cap, minimum coverage, blackout window, or advisory-only.

| Vendor | Data model exposed to admin | Control | Source |
|---|---|---|---|
| **RotaCloud** | **Minimum coverage** over four scopes — all employees / Location / Group / Role — plus an integer. Separately, a **leave embargo** (date block). Hard: "automatically denies any requests which break this" | Rule-type dropdown + numeric stepper in a sentence template; embargo uses an "All / Selected employees" checklist | [leave request rules](https://help.rotacloud.com/en/articles/10288786-how-do-i-use-leave-request-rules) · [embargoes](https://help.rotacloud.com/en/articles/10288785-how-do-i-use-leave-embargoes) |
| **Papershift** | **Named period + scope + integer cap** — field labelled "Maximum number of simultaneously confirmed absences" | Settings form: name, dates, number, application area, absence types | [help.papershift.com/en/absences/402](https://help.papershift.com/en/absences/402) |
| **Shiftbase** | Absence restriction: period + absence types + **departments** + cap. "Allowed absentees: Maximum number of absent employees per day within the specified period" | Form with department multi-select | [help.shiftbase.com/absence-restrictions](https://help.shiftbase.com/absence-restrictions) |
| **Humanity / TCP** | Global **max staff booked off at once** + blackout dates. Company-wide, not per-position | Checkbox + number in Settings → Leave & Availability | [limit staff](https://helpcenter.humanity.com/en/articles/3316420-limit-staff-for-booking-leaves-at-once) · [leave settings](https://helpcenter.humanity.com/en/articles/3276018-leave-settings) |
| **Deputy** | **No leave-concurrency object at all.** Per-person only: stress profile (fatigue) + training requirements per Area. Leave produces a soft "Not recommended — on leave" warning | Reusable named stress-profile template per employee | [stress profiles](https://help.deputy.com/hc/en-au/articles/4658226793999-Set-up-stress-profiles-and-fatigue-management) · [API](https://developer.deputy.com/docs/stressprofile) — the API has `MaxHoursPerShift`, `GapHoursBetweenShifts` etc. and **zero fields referencing another employee** |
| **When I Work** | **Nothing.** Days-notice, max paid hours per request, accrual caps | Form fields | [time off settings](https://help.wheniwork.com/articles/time-off-settings/) |
| **Planday** | **Nothing — and the vendor says so**: "As of now, you can't set such a limit. However, you can check the calendar view…" | Calendar, for eyeballing | [leave request FAQs](https://help.planday.com/en/articles/31339-leave-requests-faqs-and-troubleshooting-for-admins) |
| **7shifts** | **Blocked Days** — boolean date block scoped to locations/roles. No numeric cap | Time Off → Blocked Days; date or range + location/role pickers | [kb.7shifts.com/…/4417519498643](https://kb.7shifts.com/hc/en-us/articles/4417519498643) |
| **Connecteam** | Blackout dates only; limits are per-employee balance. Concurrency handled by *visibility* — "helps you schedule coverage and avoid too many users being off at the same time" | Policy form + date-range picker | [time off policies](https://help.connecteam.com/en/articles/6743822-creating-time-off-policies) |
| **Factorial** | Blocked periods + **Smart Recommendations** — advisory, non-configurable, hardcoded ≥1 overlap with the approver's direct reports flips a banner. Always overridable | No rule builder | [smart recommendations](https://help.factorialhr.com/en_US/absences-approvals/smart-recommendations-to-approve-absences) |
| **Zoho People** | No cross-employee model. "Clubbing Policy" restricts leave **types**, not people | Per-leave-type settings form | [leave policies](https://help.zoho.com/portal/en/kb/people/administrator-guide/leave/settings/articles/setting-up-leave-policies-in-zoho-people) |
| **Keka** | No cross-employee model — per-employee caps, gaps, type-combination bans | Leave-type config wizard | [configuring regular leave](https://help.keka.com/hc/en-us/articles/39946786434961-Configuring-Regular-Leave) |
| **Workday** | Time-off validations are **per-worker**: "Define validation rules to prevent the entry of invalid time off requests or to generate warning messages" — the condition is always the individual's own request, never an org headcount | Validation type + value + custom message on the plan | [time off validations](https://doc.workday.com/workday-education/en-us/course-manuals/absence-for-administrators/time-off-validations.html) |
| **Skedulo** | 13 schedule rules including account/location **inclusion/exclusion lists**. "Work overlap" means one resource overlapping *themselves*. **No resource↔resource exclusion** in the delivered set | Per-account / per-location resource lists | [schedule rules](https://docs.skedulo.com/developer-guides/manage-and-schedule-work/manage-scheduling-rules-and-exceptions/on-the-skedulo-pulse-platform/schedule-rules/) |
| **Microsoft Shifts** | **Nothing** — request → Approve/Deny, manager judgement | Requests tab | [manage shift requests](https://support.microsoft.com/en-us/office/manage-shift-requests-and-time-off-in-shifts-231fc82f-db7f-4f06-9215-8b36b599d69c) |
| **Sling** | Advisory conflicts, explicitly overridable: "Sling will always let you assign shifts manually if there are any conflicts" | Toggles | [auto-assign shifts](https://support.getsling.com/en/articles/5203721-auto-assign-shifts) |
| **BambooHR** | Visibility only — "Who's Out" calendar, no constraint object. help.bamboohr.com not reachable (JS shell); the public API exposes only requests/history, corroborating the absence | Calendar | [time off API](https://documentation.bamboohr.com/reference/time-off) |
| **HiBob** | **Not reachable** (403 on every help path). API has no concurrency/conflict object. **SECONDARY**, unverified: request expansion shows "who else from your team is out" — advisory | — | [apidocs.hibob.com](https://apidocs.hibob.com/reference/time-off) |
| **Nowsta** | **Not reachable** (gated portal). **SECONDARY**, unverified: per-client/per-location Preferred/Restricted worker lists — worker↔*client*, not worker↔worker | — | [community.nowsta.com](https://community.nowsta.com/support/solutions/articles/151000002114) |

### The one pairwise product

**RosterLab**, an AI rostering optimizer, is the only vendor found with a genuine
employee-to-employee constraint in **both** directions — "Ensure staff are not rostered
together (child care)" and "Ensure staff are rostered together (car pool)" — expressed as
rows in a **rule builder**, each tagged Must Have (hard) or Should Have (soft).
<https://rosterlab.com/feature/rules-engine>

That is a meaningful signal, not a counter-example: it is a constraint-solver product where
a pairwise rule is one row in a generic engine it already had, rather than a screen someone
designed for the purpose. Field-service tools (Skedulo, Nowsta) do ship exclusion lists, but
they are person↔*client/location* — never person↔person.

**Read:** the entire market picked the capped group. RotaCloud's inversion — *minimum
available* rather than *maximum absent* — reads better to an admin because it names the
thing actually cared about (coverage), and is worth stealing as wording even if not as model.

---

## The interaction patterns

### 1. Symmetric adjacency matrix (N×N checkboxes, upper triangle)

A cell whose meaning depends on both a row and a column header is exactly W3C's
**multi-level table**: "each table header is represented by a (document-wide) unique `id`.
Data cells refer to those `id`s by listing one or more in their `headers` attribute"
([WAI tables tutorial](https://www.w3.org/WAI/tutorials/tables/multi-level/)). The same page
states the problem in W3C's own words — "Such tables are too complex to identify a strict
horizontal or vertical association between header and data cells" — and recommends **not
building them**: "it is worth considering to restructure the information in such tables to
make them less complex for all readers, for example by splitting the information in smaller,
more manageable tables."

WCAG technique [H43](https://www.w3.org/TR/WCAG20-TECHS/H43.html) makes `headers`/`id`
mandatory when "data cells are associated with more than one row and/or one column header"
because "the relationships are too complex to be identified using the `th` element alone."
If the cells are interactive you additionally inherit APG's
[grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) model — one tab stop plus roving 2-D
arrow keys — and APG warns that grids departing from its two sanctioned designs "add
complexity for authors or users or both."

NN/g on [data tables](https://www.nngroup.com/articles/data-tables/): comparison is the
failure mode — when compared columns are far apart users must "memorize data from one
column." Their four supported tasks are find / compare / view-edit-a-row / act-on-records;
"define a symmetric relation" is not among them.

**SECONDARY** (authoritative practitioner, not a spec): Adrian Roselli's JAWS testing found
screen readers announcing both "table" and "grid", wrong row/column positions, and "only
cell" announcements — "you should probably ignore ARIA `grid` unless you are trying to
recreate Excel." <http://adrianroselli.com/2020/07/aria-grid-as-an-anti-pattern.html>

- **No primary source found** for a documented maximum N. No design system reached (Carbon,
  Polaris, Fluent, Spectrum, USWDS, Atlassian) ships a first-party matrix *input* pattern at
  all. That absence is the strongest signal available.
- **Pros:** the whole relation is visible at once; symmetry is structurally enforced by
  drawing only the upper triangle.
- **Cons:** O(N²) — 435 cells at N = 30; W3C tells you to split rather than build; no
  precedent to copy.
- **A11y verdict: worst of the five.** Defensible only at very small N (≤ 8), and even then
  you author the pattern yourself.

### 2. Per-person "cannot overlap with" token field

APG's [combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) documents single
selection only — "only one suggested value to be selected at a time" — so **there is no
multi-select combobox pattern in APG**. Multi-select lands on
[listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/): "If the listbox supports
selection of more than one option, the element with role `listbox` has
`aria-multiselectable` set to `true`", with Space-to-toggle preferred over Shift/Ctrl.

Design systems do ship the control: Atlassian Select "allows users to make a single
selection or multiple selections", with Checkbox-select and Creatable variants
([atlassian.design](https://atlassian.design/components/select/examples)); Fluent 2 ships a
multi-select dropdown and a [tag picker](https://fluent2.microsoft.design/components/web/react/core/tagpicker/usage)
that "can also be used in multi-select scenarios"; Carbon's multiselect is for selecting
"multiple options from a list and filter"
([carbondesignsystem.com](https://carbondesignsystem.com/components/dropdown/usage/)).
Adobe's [React Spectrum ComboBox](https://react-spectrum.adobe.com/react-spectrum/ComboBox.html)
does **not** support multiple selection. Polaris could not be verified — polaris.shopify.com
now 301s to shopify.dev.

- **No primary source found** for the often-quoted Carbon "use multiselect above N options"
  threshold. Carbon states only a floor ("not… if there are two options — use a radio button
  group") and a presentational note about scrolling around the sixth option.
- **No primary source found** for how to keep a symmetric relation in sync across two token
  fields. That mirroring rule is a design decision you must make and communicate.
- **Pros:** linear in N; type-to-filter scales past 30; four design systems ship it.
- **Cons:** the relation is symmetric but the UI is directed — each pair appears twice, and
  "A lists B without B listing A" is representable-but-wrong unless you enforce mirroring.
- **A11y verdict: best supported of the interactive options**, built as a combobox
  controlling an `aria-multiselectable` listbox, with removable chips as real buttons.

### 3. Named groups with a cap

The textbook case. `<fieldset>` + `<legend>` so users grasp "smaller and more manageable
groups rather than try to grasp the entire form at once", with one quoted caveat —
"Depending on the configuration, some screen readers read out the legend either with every
form element, once, or, rarely, not at all" — so keep legends short and make each checkbox
label stand alone ([WAI grouping tutorial](https://www.w3.org/WAI/tutorials/forms/grouping/)).
`role="group"` + `aria-labelledby` is the sanctioned ARIA equivalent.
[USWDS](https://designsystem.digital.gov/components/checkbox/): "Surround a related set of
checkboxes with a `<fieldset>`. The `<legend>` provides context for the grouping", and use
checkboxes "when a user can select any number of choices from a list." Neither USWDS nor
Carbon documents a maximum option count.

- **No primary source found** for repeated/nested "add another group" form sections, nor for
  how many groups is too many. NN/g's mitigation is generic: staged disclosure to "minimize
  the appearance of clutter within the interface without reducing the capability of the
  application" ([complex application design](https://www.nngroup.com/articles/complex-application-design/)).
- **Pros:** the only pattern using nothing but native primitives; the only one that can say
  "at most 2 of these 5" at all; scales by grouping rather than by enumerating pairs.
- **Cons:** the admin must think in sets, not pairs; a one-off pair needs a two-person group.
- **A11y verdict: the easy case, and the clear winner.** fieldset + legend + checkbox +
  `<input type="number">`, all native, zero custom ARIA.

### 4. Rule builder / condition rows

Salesforce ships this first-party. SLDS **Expression**: "An Expression builder helps users
declaratively construct logical expressions" — condition rows of resource/operator/value,
AND/OR operators, nested expression groups, per-row legends and action buttons, and states
for empty/single/multiple/grouped/disabled/error. Marked **"Desktop Only"**.
<http://v1.lightningdesignsystem.com/components/expression/> (the canonical
lightningdesignsystem.com URL 301s here). **No equivalent first-party rule-builder pattern
was found in Atlassian, Carbon, Polaris, Fluent, Spectrum or USWDS.**

NN/g's documented mitigation is progressive disclosure, which "defers advanced or rarely
used features to a secondary screen" and "improves 3 of usability's 5 components:
learnability, efficiency of use, and error rate"
([progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/)). And the
audience warning that matters here — NN/g's Legend / Legacy / Learner typology: "Designing
for just one of these groups creates long-term risk"
([complex-app users](https://www.nngroup.com/articles/complex-apps-users/)). A rule builder
is designed for the Legend; the studio admin is a Learner.

- **No primary source found** for any measured error-rate or task-time cost of rule builders
  versus simpler pickers. SLDS documents *how*, never *when it is worth it*.
- **Pros:** the only pattern with a copyable first-party spec; generalises beyond exclusion.
- **Cons:** surface far larger than a symmetric pair needs; SLDS itself marks it Desktop Only.

### 5. Graph / node-link editor

**The evidence is thin, and honesty requires saying so.** No NN/g article on node-link
diagrams or graph editing was found. The one research-grade source is **SECONDARY** and about
*reading*, not *editing*: Saket et al., "Node, Node-Link, and Node-Link-Group Diagrams: An
Evaluation" (IEEE InfoVis), <https://arxiv.org/pdf/1404.1911> — a nine-task comparison
reporting that adding links does not degrade node-based task performance. The PDF body could
not be extracted, so treat it as reported-not-verified. Neither it nor the related
cognitive-load work (<https://arxiv.org/pdf/2008.07944>) addresses authoring constraints,
non-expert users, or accessibility.

**No accessibility pattern exists at all** — neither APG nor any design system checked
documents an accessible node-link editor. There is no role for a graph, no keyboard model, no
announcement convention.

- **A11y verdict: not defensible** without a full parallel non-visual editor — at which point
  build the parallel editor and skip the graph.

### Cross-cutting

| Pattern | First-party precedent | A11y cost | Expresses "at most K of N"? |
|---|---|---|---|
| Matrix | none found anywhere | highest — W3C says restructure instead | no (pairs only) |
| Token field | Atlassian, Carbon, Fluent, Spectrum | low–moderate; APG has no multi-select combobox | no (pairs only) |
| Group + cap | native HTML; USWDS, Carbon, W3C | lowest — fieldset/legend, nothing custom | **yes** |
| Rule builder | SLDS Expression only | moderate; Desktop Only | yes, at high cost |
| Graph editor | none | undefined — no pattern exists | n/a |

*No primary source ranks these five against each other; that comparison is this note's.*

---

## Building blocks actually available in this repo

**Important correction to the brief's premise, in both directions.**

shadcn/ui's [Combobox](https://ui.shadcn.com/docs/components/combobox) is **no longer
documented as a Command + Popover composition**. It is a real component with three
implementation variants (Base UI, React Aria, Radix UI), real sub-components
(`ComboboxInput`/`Content`/`List`/`Item`), and a documented **Multiple Selection** section
using a `multiple` prop plus `ComboboxChips`. `Command`, `Popover`, `Badge`, `Toggle`,
`ToggleGroup`, `Table`, `Checkbox` and `Select` all exist
(<https://ui.shadcn.com/docs/components>); standalone `MultiSelect` and `TagsInput` do not.

**But none of that is free here.** `fe-portal` does not use shadcn's dependency stack:
`fe-portal/package.json` lists **no `@radix-ui/*`, no `cmdk`, no `@base-ui`, no
`react-aria`**. Its `src/components/ui/` primitives are hand-rolled over native elements —
`select.tsx` is a plain styled `<select>`, `dialog.tsx` is a `createPortal` + Escape-key
handler, `badge.tsx` is `cva` classes. Adopting shadcn's Combobox means adding a component
library to an app that has deliberately avoided one.

What is genuinely present, and enough for patterns 2 and 3 both:
`button`, `input`, `label`, `select`, `dialog`, `sheet`, `tabs`, `tooltip`, `badge`, `avatar`,
`empty-state`, `skeleton`, `status-badge`, `page-header`, `textarea` — plus native
`<input type="checkbox">`, `<fieldset>`/`<legend>` and `<input type="number">`, which is
exactly the kit pattern 3 needs and exactly what the policy page already uses.

---

## The modelling trade-off

**A pair is a group of two with cap 1.** Named capped groups strictly subsume pairwise
constraints; pairwise does not subsume groups. Nothing expressible as "A never with B" is
lost by modelling it as a two-person group, while "at most 2 of these 5" cannot be expressed
by any set of pairs at all — pairs can only say K = 1.

For this studio — two locations, a handful of instructors per style — the realistic
requirement is almost certainly *coverage*, not personal incompatibility. "At least one
Hatha instructor must be at Outram" is a coverage statement; "Alice and Bob must not both be
away" is that same statement when Alice and Bob are the only two Hatha instructors there.
The pairwise framing is the coverage rule with the reason stripped out, and it stops being
correct the moment a third Hatha instructor is hired: the pair rule keeps refusing, the
capped group correctly relaxes. The whole vendor market reaching the same conclusion
independently (see above) is corroboration, not coincidence.

Costs, plainly:

| | Pairwise (`(a, b)` rows) | Named capped groups |
|---|---|---|
| **Schema** | One table, `(a, b)` with `a < b` to make symmetry a constraint rather than a convention. Simplest possible. | Two tables (group + membership) with a name and a cap per group. Drops `in_cover_group` and `cover_group_leave_cap`. |
| **Rule change** | Counted set = the applicant's partners; cap is hard-wired at 1. `peakLeaveAway` is unchanged. | Counted sets = one per group the applicant belongs to, each with its own cap. `leaveCapExceedance` already loops over a `counted[]` array (`rules.ts:549-561`) — this is the shape it was written in. |
| **Lock widening** | Lock the applicant's partners' rows. Narrower than today. | Lock rows of every group the applicant is in. Same shape as today (`requests.ts:487-496`). |
| **Refusal clarity** | Best case. "Alice is already on leave on 18 Aug" needs no further explanation. | Needs the group's name to stay legible once there is more than one group: *"Alice is already on leave on 18 Aug. At most 1 of Outram Cover can be away at once."* The name is why the group must have one. |
| **Admin comprehension** | Immediate — but O(N²) facts to maintain, and adding an instructor means revisiting every existing pair. | One more concept (the group), but O(groups) facts, and hiring means ticking one box in one group. |
| **UI a11y** | Needs a multi-select per person — the one pattern APG does not cover — or a per-person dialog reusing the existing checkbox list. | Repeats the control already on the page, inside a `fieldset`/`legend`. Zero custom ARIA. |

The one honest point for pairwise: it is the smaller schema and the clearer message, and if
the studio's requirement really is two named people who cannot cover for each other for a
non-coverage reason, groups make you invent a group name for a fact that has none.

---

## Recommendation

### Option 1 — Named Cover Groups, each with its own cap *(recommended)*

Replace the boolean and the single integer with several named groups, each holding members
and a cap. A pair becomes a two-person group at cap 1, so the pairwise requirement is met
without a second concept.

**Why:** strictly more expressive than pairs; the only pattern that can also say "at most 2
of these 5"; matches what every vendor with a working model shipped; fixes the two-locations
gap; and reuses the exact control already on the policy page, inside a `fieldset`/`legend`,
with no new dependency in an app that has deliberately avoided a component library.

**What it costs:** one migration (two tables in, two columns out) — and note the CLAUDE.md
rule that schema changes go through review by both backend devs. `leaveCapExceedance` is
already written as a loop over a `counted[]` array, so the rule change is feeding it more
entries rather than restructuring it; `rules.test.ts` grows cases rather than changing shape.
The refusal message must gain the group name (`rules.ts:521-528` and the email variant at
`rules.ts:577-584`), which is a copy change with a redaction question attached: a group name
is studio-visible, so it must not encode anything the leave calendar redacts. `LeaveCapPeer.
inCoverGroup` (`rules.ts:449`) becomes a set of group ids, touching `requests.ts` in the two
places that build peers (`:549-567`, `:879-899`). The lock keeps its shape but its where
clause widens to "every group the applicant is in." The API's `cover_group_staff_ids` array
becomes a nested shape, and `updateGlobalPolicy`'s wholesale-replace transaction
(`update.ts:51-80`) becomes a per-group replace with the same ordering discipline. This is
the larger of the two options, and it is mostly breadth, not depth.

**What it does not buy:** asymmetry, per-leave-type groups, date-bounded rules. None was asked
for; §17's warning about buying concepts nobody requested still applies to those.

### Option 2 — Pairwise "cannot overlap with", per instructor

One table of unordered pairs with `a < b`, edited from each instructor's row via a dialog
that reuses the existing checkbox list rather than introducing a multi-select.

**Why you might:** it is exactly the sentence the admin said; the schema is one table; the
refusal message needs no change at all beyond dropping the cap clause; and the mirroring
problem that sinks the token-field pattern disappears if the canonical `a < b` ordering is a
database constraint rather than application code.

**What it costs:** less code than Option 1, but it *narrows* the model — "at most 2 of the
5 Outram instructors" becomes permanently unsayable, and the existing studio-wide cap has to
either survive alongside it (two overlapping concepts on one screen, which is worse than one
generalised concept) or be dropped, losing the ability to express what it expresses today.
Editing is O(N²) facts, and every new hire means revisiting the list. The a11y story is the
weakest of the viable options unless the per-person editor is a dialog over the existing
checkbox list — in which case it is fine, and the multi-select question never arises.

### The tiebreak

Option 1 if the underlying need is coverage — which the two-location structure and every
vendor's convergence both suggest it is. Option 2 only if the admin, asked directly, describes
specific *people* who cannot be away together for a reason unrelated to who can teach what.
That question is cheap to ask and settles it; it is worth asking before either is built.

### Decision (2026-08-17)

**Option 2.** Asked the tiebreak question directly, the admin's answer was *specific people,
for a reason unrelated to who can teach what* — not coverage. That is the one case this note
says picks pairwise over groups, so the pairwise narrowing is accepted knowingly: "at most 2
of the 5 Outram instructors" stays unsayable, and adding an instructor means revisiting pairs.

Still open, and it is the real design question inside Option 2: **what happens to the
existing studio-wide Cover Group cap** — kept alongside pairs (two overlapping concepts on
one screen) or dropped (losing what it expresses today).

**Settled: dropped.** Two overlapping concepts on one screen was the worse of the two, so the
Cover Group and its cap were removed entirely — `#51`–`#53`, shipped 2026-08-17. `Leave Cap`
now means the Study Leave cap alone. Losing the set cap had one consequence this note did not
anticipate: the old refusal could name the colleagues *without* saying which cap was reached
only because two caps made the reason ambiguous. With one left, that wording would leak a
colleague's Leave Type by elimination, so the two refusals had to diverge — the conflict one
names the partner, the study-cap one names nobody. See `spec-pre-launch-batch.md` §17.

**Rejected outright:** the N×N matrix (W3C tells you to restructure rather than build it, and
no design system ships one), the graph editor (no accessibility pattern exists), and the rule
builder (SLDS-only precedent, marked Desktop Only, aimed at expert users). Also still
rejected, on §17's original reasoning: deriving cover from `instructor_class_types`.
