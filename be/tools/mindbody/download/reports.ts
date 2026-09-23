/**
 * What to download, report by report: the settings that select "everything"
 * (all locations, staff and categories, every view, inactive included), and
 * the cutover profile — only the files the transform reads.
 *
 * Nothing here names a studio. Option values are Mindbody's own form values;
 * a studio's locations, staff and categories are read off the page at run time.
 *
 * type:
 *   legacy    - old /ASP/adm pages: fill frmParameter once, then POST it per date piece -> .xls (an HTML table)
 *   mvc       - /…Report pages: set fields (multi-lists get every option), then #excel-button
 *   react     - new app page (Time Clock): MUI controls
 *   scrape    - no Excel button: read the HTML tables and write .xlsx ourselves
 *   health    - Client Health Check: "Request Report" (all filters already all-selected)
 *   requested - new-style page (Membership New Version): Export queues a job, download it from Requested Reports
 *   post      - POST <path>/Excel directly (pages that freeze the browser when rendered)
 *
 * set: { fieldName: value }  select -> option value, text -> string, checkbox -> true/false, radio -> value.
 *   Dates use tokens, filled from the run date (`./plan.ts`): '$START', '$TODAY', '$FUTURE1Y', '$FUTURE'.
 *   An array is a repeated field (post only); '*' is "every option of that select" (post only).
 * allMulti: every <select multiple> gets every option selected (mvc pages).
 * variants: [{ label, set, ...override }] -> one file per output SHAPE the report offers
 *   (Detail + Summary views, group-bys, list types, Old/New version); override can change type/path.
 * loopSelect: one file per option of that select (the report has no "All" option).
 *   loopSkip: option values to leave out; loopOnly: a pattern option values must match.
 * split: start splitting the date range at this step (one file per piece) rather than only when refused.
 *
 * Audit of every report's shape options (the one-off recon, kept outside the repo):
 *   Membership            Old Version (totals) + New Version Detail (one row per member)
 *   Last Visit            its "Scheduled report" page (/LastVisitReportAsync) has the same filters -> not needed
 *   Contact Logs          dropped: thousands of day files of automated emails, and nothing reads them
 *   Cancellations         Individual records + Group cancellations
 *   Attendance w/o Rev.   every "View by" type
 *   Attendance Analysis   every "Analysis by" x Summary/Detail
 *   Big Spenders          Detail/Summary x Accrual/Cash basis
 *   Payroll               Detail, Summary, Summary by Pay Rate, Paycheck Pickup
 *   Referral Types        every referrer group;  Clients per Teacher: summary + each teacher
 *   mvc Detail/Summary    First Visit, Unpaid, Last Visit, Visits Remaining, Client Arrivals, Entry Logs, Ratings
 *   legacy Detail/Summary Retention, Promotions, Referrers
 *   Not variants (sort order / subset of "all" only): sort-by, No-Show type, cancel type, list-for, opt-in.
 */

export type RunnerType = 'legacy' | 'mvc' | 'react' | 'scrape' | 'health' | 'post' | 'requested'
export type StepName = 'year' | 'quarter' | 'month' | 'week' | 'day'
export type FieldValue = string | boolean | string[]
export type FieldSet = Record<string, FieldValue>

/** What a variant may change about its report, beside the fields it sets. */
export type ReportOverride = {
  type?: RunnerType
  path?: string
  requestedName?: string
  check?: string[]
}

export type Variant = ReportOverride & { label: string; set?: FieldSet }

export type Report = {
  /** The number every file name of this report starts with. Never reused, even for a dropped report. */
  num: number
  name: string
  cat: 'Clients' | 'Staff' | 'Sales'
  path: string
  type: RunnerType
  set?: FieldSet
  allMulti?: boolean
  variants?: Variant[]
  loopSelect?: string
  loopSkip?: string[]
  loopOnly?: RegExp
  submit?: boolean
  requestedName?: string
  check?: string[]
  split?: StepName
}

/** A cutover-profile entry: a report narrowed to what the transform reads. */
export type ProfileEntry = Report & {
  /** The `kind` of its entry in `report-files.json`; none for a file the transform does not read. */
  kind?: string
  /** Keep exactly one loop option: the one whose text matches, written under `label`. */
  loop?: { match: RegExp; label: string }
  /** Not read by the transform: a failure is reported but does not fail the run. */
  optional?: boolean
}

/** Big Spenders lists at most this many clients, biggest first: the ones past it are simply not in the file. */
export const BIG_SPENDERS_CAP = 10_000

const DETAIL_SUMMARY: Variant[] = [{ label: 'Detail', set: { View: 'Detail' } }, { label: 'Summary', set: { View: 'Summary' } }]
const DATES: FieldSet = { requiredtxtDateStart: '$START', requiredtxtDateEnd: '$TODAY' }
const MVC_DATES: FieldSet = { Start: '$START', End: '$TODAY' }

type Draft = Omit<Report, 'num' | 'cat'> & { dropped?: boolean }

const CLIENTS: Draft[] = [
  { name: 'Membership', path: '/ASP/adm/adm_rpt_membership_stats.asp', type: 'legacy',
    set: { optSaleLoc: '0', optIncludeSeries: true, optReturnedSeries: true },
    variants: [
      { label: 'Old Version (totals)' },
      // New Version: all memberships/statuses/locations are pre-selected; Detail = one row per member, as of today.
      { label: 'New Version Detail', type: 'requested', path: '/VIPMembershipReport/MembersReport?category=',
        requestedName: 'Members Report', check: ['Detail View'] },
    ] },
  { name: 'Mailing Lists', path: '/ASP/adm/adm_rpt_mailer.asp', type: 'legacy',
    set: { optListFor: '13', optOptIn: '0', optProspectYN: '2' },
    variants: [
      { label: 'Mailing List', set: { optListType: '0' } },
      { label: 'Email List', set: { optListType: '1' } },
      { label: 'Sales List', set: { optListType: '2' } },
    ] },
  { name: 'Ratings and Reviews', path: '/reviewsreport', type: 'mvc', allMulti: true,
    set: { ...MVC_DATES, DateType: 'Service', ServiceCategoryID: '0' },
    variants: [
      { label: 'Detail', set: { View: 'Detail' } },
      { label: 'Summary by Staff', set: { View: 'Summary', GroupBy: 'Staff' } },
      { label: 'Summary by Service', set: { View: 'Summary', GroupBy: 'Service' } },
    ] },
  { name: 'Account Balances', path: '/ASP/adm/adm_rpt_acct_bal_list.asp', type: 'legacy',
    set: { chkNegOnly: '0', optLocation: '0', optBillingInfo: 'all', optSortBy: '0' },
    variants: [{ label: 'All balances' }, { label: 'Event balances only', set: { optEventBal: true } }] },
  // Dropped on purpose: hundreds of day files of automated emails, and nothing reads them. Kept so
  // every later report keeps its number. Detail lists only the first 500 logs per request.
  { name: 'Contact Logs', dropped: true, path: '/ASP/adm/adm_rpt_conlogfollowup.asp', type: 'legacy',
    set: { ...DATES, optTrainer: '-2', optSaleLoc: '0' },
    variants: [
      { label: 'Detail by Created by', set: { optView: '0', optGroupBy: '0' } },
      { label: 'Detail by Assigned to', set: { optView: '0', optGroupBy: '1' } },
      { label: 'Summary by Created by', set: { optView: '1', optGroupBy: '0' } },
      { label: 'Summary by Assigned to', set: { optView: '1', optGroupBy: '1' } },
    ] },
  { name: 'Entry Logs', path: '/Entrylogsreport', type: 'mvc', allMulti: true,
    set: { ...MVC_DATES, LoginTypeID: '0', StartTimeID: '-1', EndTimeID: '-1' }, variants: DETAIL_SUMMARY },
  { name: 'Client Health Check', path: '/MemberHealthReport', type: 'health' },
  { name: 'Cancellations', path: '/ASP/adm/adm_tlbx_advcanc_rest.asp', type: 'legacy',
    set: { ...DATES, optDate: 'range', optCancLoc: '0', optCancInstructor: '0', optCancelType: '', optMode: 'all', optClient: 'all' },
    variants: [{ label: 'Individual records', set: { optDisplay: '1' } }, { label: 'Group cancellations', set: { optDisplay: '2' } }] },
  { name: 'First Visit', path: '/FirstVisitReport', type: 'mvc', allMulti: true,
    set: { ...MVC_DATES, IncludeInactiveClients: true }, variants: DETAIL_SUMMARY },
  { name: 'Unpaid Visits', path: '/Unpaidvisitsreport', type: 'mvc', allMulti: true,
    set: { ...MVC_DATES, SelectAllDates: true, ServiceCategoryID: '0', ShowFutureUnpaids: true }, variants: DETAIL_SUMMARY },
  { name: 'Last Visit', path: '/LastVisitReport', type: 'mvc', allMulti: true,
    set: { ...MVC_DATES, StaffMemberID: '0', IncludeInactiveClients: true, VisitsGreaterThan: '0', SpecificDate: '$TODAY' }, variants: DETAIL_SUMMARY },
  { name: 'Attendance Analysis', path: '/Report/Clients/AttendanceAnalysis', type: 'mvc', allMulti: true, loopSelect: 'optAnalysisBy',
    set: { ...DATES, optTGVT: '', optTrn: '', optCountNoShowsAndCancel: true },
    variants: [{ label: 'Summary', set: { optView: 'Summary' } }, { label: 'Detail', set: { optView: 'Detail' } }] },
  { name: 'Pricing Option Expirations', path: '/ASP/adm/adm_rpt_series_exp.asp', type: 'legacy',
    set: { requiredtxtDateStart: '$START', requiredtxtDateEnd: '$FUTURE', optSaleLoc: '0', optSalesRep: '0', optSeriesType: '', optTG: '0',
      chkCurrOnly: false, // "Active pricing options only"
      chkOnDeckSeries: true, // "Factor in On-Deck Pricing Options/Autopays"
      chkReturned: false } }, // "Filter Out Returned Pricing Options" -> off keeps them
  { name: 'New Members', path: '/ASP/adm/adm_rpt_new_members.asp', type: 'legacy',
    set: { ...DATES, optSaleLoc: '0' } },
  { name: 'Visits Remaining', path: '/VisitsRemainingReport', type: 'mvc', allMulti: true,
    set: { ...MVC_DATES, ServiceCategoryID: '0', ShowExpiredPricingOptions: true, VisitsRemGreaterThan: '0' }, variants: DETAIL_SUMMARY },
  { name: 'Attendance without Revenue', path: '/AttendanceReport/IndexNoRevenue', type: 'mvc', allMulti: true, loopSelect: 'ViewTypeID',
    set: { ...MVC_DATES, StaffMemberID: '0' } },
  // Rendering this page (it builds today's grid for every staff member) freezes the browser -> post the Excel endpoint.
  // '*' = every location the studio has, read off the page.
  { name: 'Schedule at a Glance', path: '/Report/Staff/ScheduleAtAGlance', type: 'post',
    set: { ...DATES, optfilterByCreated: 'Scheduled', optSaleLoc: '*', optTrn: '0', optTG: '', optStatus: '', optBookingType: '',
      optFilterTagged: 'false', optShowAccountBalance: 'on', optShowSeriesRemaining: 'on', optShowPhoneNumbers: 'on', optShowScheduledBy: 'on', optShowResources: 'on' } },
  { name: 'Retention', path: '/asp/adm/adm_rpt_retention.asp', type: 'legacy',
    set: { ...DATES, optInitialSaleLoc: '0', optInitialTrn: '0', optRetentionSaleLoc: '0', optRetentionTrn: 'any', optRepeatDef: '0', optPmtTG: '0' },
    variants: [{ label: 'Detail', set: { optSummary: '1' } }, { label: 'Summary', set: { optSummary: '0' } }] },
  { name: 'Big Spenders', path: '/ASP/adm/adm_rpt_big_spenders.asp', type: 'legacy',
    set: { ...DATES, optProdServ: '2', optTG: '0', optSaleLoc: '0', optNewClientOnly: '0', optMinValue: '0.00',
      // "Top N" clients: a client past it loses every sale. The Summary view errors (HTTP 500) at 100000, so it
      // cannot simply be huge; the cutover download checks it against the Members instead (`./sales-cap.ts`).
      optTopNum: String(BIG_SPENDERS_CAP) },
    variants: [
      { label: 'Detail Accrual', set: { optSummary: '0', optBasis: '0' } },
      { label: 'Detail Cash', set: { optSummary: '0', optBasis: '1' } },
      { label: 'Summary Accrual', set: { optSummary: '1', optBasis: '0' } },
      { label: 'Summary Cash', set: { optSummary: '1', optBasis: '1' } },
    ] },
  { name: 'Client Indexes', path: '/ASP/adm/adm_rpt_clt_index.asp', type: 'legacy', loopSelect: 'optIndex', loopSkip: ['0'],
    set: { optSaleLoc: '0', optRep: '0', optIncInactiveIndex: true, optIncUnassigned: true, optIncInactive: true } },
  { name: 'Referral Types', path: '/ASP/adm/adm_rpt_referral.asp', type: 'legacy', loopSelect: 'optRefby',
    set: { ...DATES, optReferralLoc: '0' } },
  { name: 'No Return', path: '/ASP/adm/adm_rpt_no_return.asp', type: 'legacy',
    set: { ...DATES, optPackage: '0', optLoc: '0' } },
  { name: 'Promotions', path: '/ASP/adm/adm_rpt_promotions.asp', type: 'legacy',
    set: { ...DATES, optSaleLoc: '0', optPromotion: '' },
    variants: [{ label: 'Detail', set: { optDisMode: '1' } }, { label: 'Summary', set: { optDisMode: '0' } }] },
  { name: 'Retention Management', path: '/ASP/adm/adm_rpt_retention_mgmnt.asp', type: 'legacy',
    set: { optActiveOnly: false } },
  { name: 'Clients per Teacher', path: '/ASP/adm/adm_rpt_clients_per_trn.asp', type: 'legacy', loopSelect: 'optTrainer',
    set: { ...DATES, optLoc: '0' } },
  { name: 'No-Shows', path: '/ASP/adm/adm_rpt_noshows.asp', type: 'legacy',
    set: { ...DATES, optNoShowType: '2', optSaleLoc: '0', optTrainer: '0', optServiceCat: '0', optSortBy: '0' } },
  { name: 'Client Arrivals', path: '/ClientArrivalsReport', type: 'mvc', allMulti: true,
    set: { ...MVC_DATES }, variants: DETAIL_SUMMARY },
  { name: 'Online Metrics', path: '/ASP/adm/adm_rpt_metrics.asp', type: 'scrape', submit: true,
    set: { optDate: 'all' } },
  { name: 'Referrers', path: '/ASP/adm/adm_rpt_referrers.asp', type: 'legacy',
    set: { ...DATES, optLocation: '0' },
    variants: [{ label: 'Detail', set: { requiredtxtView: 'detail' } }, { label: 'Summary', set: { requiredtxtView: 'summary' } }] },
  { name: 'Event Payments', path: '/ASP/adm/adm_rpt_event_invoice.asp', type: 'legacy',
    set: { requiredtxtDateStart: '$START', requiredtxtDateEnd: '$FUTURE', optRptLoc: '0' } },
  { name: 'Locker', path: '/ASP/adm/adm_rpt_locker.asp', type: 'legacy', set: {} },
]

const STAFF: Draft[] = [
  { name: 'Payroll', path: '/ASP/adm/adm_rpt_ipay_new.asp', type: 'legacy',
    set: { ...DATES, optPayRate: '0', optPayLocation: '0', optTG: '0', optActive: true, optShowComps: true },
    variants: [
      { label: 'Detail', set: { optTrnPayList: '-1' } },
      { label: 'Summary', set: { optTrnPayList: '-2' } },
      { label: 'Summary by Pay Rate', set: { optTrnPayList: '-4' } },
      { label: 'Paycheck Pickup', set: { optTrnPayList: '-3' } },
    ] },
  { name: 'Time Clock', path: '/app/reports/staff/time-clock', type: 'react' },
  { name: 'Staff Schedule', path: '/ASP/adm/adm_rpt_trn_avail.asp', type: 'legacy', loopSelect: 'optTrainer',
    set: { requiredtxtDateStart: '$START', requiredtxtDateEnd: '$FUTURE', optTG: '0' },
    variants: [{ label: 'Scheduled', set: { optRegSched: false } }, { label: 'Regular Schedule', set: { optRegSched: true } }] },
  { name: 'Phone Book', path: '/ASP/adm/adm_rpt_staff_phone.asp', type: 'legacy',
    set: { optStaffType: '0', optSaleLoc: '0', chkIncInactive: true } },
  { name: 'Staff Performance', path: '/Report/Staff/StaffPerformance', type: 'mvc', allMulti: true,
    set: { ...DATES, optUseMoreDates: false, optCountNoShowsAndCancel: true } },
  { name: 'Appointment Metrics', path: '/Report/Staff/AppointmentMetrics', type: 'mvc', allMulti: true,
    set: { ...DATES, optTG: '', optInstructor: '' } },
  { name: 'Pay Rates', path: '/ASP/adm/adm_rpt_payrates.asp', type: 'scrape' },
  { name: 'Staff Activity', path: '/ASP/adm/adm_rpt_elogs_activity.asp', type: 'legacy',
    set: { ...DATES, optUsername: '' } },
  { name: 'Retail Sales Performance', path: '/Report/Staff/RetailSalesPerformance', type: 'post',
    set: { ...DATES, optFilterTagged: 'false', optSaleLoc: '*', optTG: '', optCategory: '*', optInstructor: '' } },
  { name: 'Tasks', path: '/ASP/adm/adm_rpt_tasks.asp', type: 'legacy',
    set: { ...DATES, optEmployee: '-1', optComplete: 'all' } },
  // Options are "category#0" (a whole service category) and "category#visitType"; a whole category covers its visit types.
  // "Show All?" (optShowAll) makes no difference to the export for any category -> not a variant.
  { name: 'Trainer Conversions', path: '/ASP/adm/adm_rpt_conversions.asp', type: 'legacy', loopSelect: 'requiredtxtVisitType', loopOnly: /#0$/,
    set: { ...DATES, txtSalesRecordedStart: '$START', txtSalesRecordedEnd: '$TODAY', optTrainer: '', optShowNoResults: true } },
]

// Each report keeps the number it has always had in file names, whatever is dropped before it.
const NUMBERED: (Report & { dropped?: boolean })[] = [
  ...CLIENTS.map(r => ({ ...r, cat: 'Clients' as const })),
  ...STAFF.map(r => ({ ...r, cat: 'Staff' as const })),
].map((r, i) => ({ ...r, num: i + 1 }))

/**
 * Every report under Reports → Clients and Reports → Staff but the dropped one.
 * Reports listed under both tabs (Ratings and Reviews, Cancellations, Schedule at
 * a Glance, Clients per Teacher) are kept once, under Clients.
 */
export const REPORTS: Report[] = NUMBERED.filter(r => !r.dropped).map(({ dropped: _, ...r }) => r)

function pick(name: string, over: Partial<ProfileEntry> & { variants?: never; only?: string[]; dates?: FieldSet } = {}): ProfileEntry {
  const r = REPORTS.find(x => x.name === name)
  if (!r) throw new Error(`cutover profile: no report called ${name}`)
  const { only, dates, ...rest } = over
  const variants = only ? (r.variants ?? []).filter(v => only.includes(v.label)) : r.variants
  if (only && variants?.length !== only.length) throw new Error(`cutover profile: ${name} has no variant ${only.join(', ')}`)
  return { ...r, ...rest, variants, set: { ...r.set, ...dates } }
}

/**
 * The cutover profile: only what the transform reads, each in exactly the view
 * and under exactly the name its matcher expects, into a fresh dated folder.
 * `kind` ties an entry to its line in `report-files.json`, which is where the
 * file name and the single/required rules live; `plan.test.ts` holds the file
 * names this plan writes to that list.
 */
export const CUTOVER: ProfileEntry[] = [
  // Who the members are.
  pick('Mailing Lists', { kind: 'members', only: ['Mailing List'] }),
  // One file per referrer group; the Summary group is downloaded too and ignored by the transform.
  pick('Referral Types', { kind: 'referrals' }),
  pick('Retention Management', { kind: 'retention' }),
  pick('Account Balances', { kind: 'balances', only: ['All balances'] }),
  // What they hold: the live packages and the catalogue proposal.
  pick('Visits Remaining', { kind: 'holdings', only: ['Detail'] }),
  pick('Pricing Option Expirations', { kind: 'optionSales' }),
  pick('Big Spenders', { kind: 'sales', only: ['Detail Accrual'] }),
  // What a promotion took off each of those sales, by sale number: a past sale's List Price.
  pick('Promotions', { kind: 'promotions', only: ['Detail'] }),
  // Their past visits (history): Date view only — the other views are the same rows re-sorted.
  pick('Attendance without Revenue', { kind: 'attendance', loop: { match: /^date$/i, label: 'Date' }, split: 'year' }),
  // Who is booked into what, past and to come: from the history cutoff to 12 months ahead, one file per year.
  pick('Schedule at a Glance', { kind: 'roster', dates: { requiredtxtDateStart: '$START', requiredtxtDateEnd: '$FUTURE1Y' }, split: 'year' }),
  // Staff and the timetable (every class, empty ones included, up to 5 years ahead).
  pick('Phone Book', { kind: 'phoneBook' }),
  pick('Staff Schedule', { kind: 'schedule', loop: { match: /^all$/i, label: 'ALL' }, only: ['Scheduled'] }),
  pick('Pay Rates', { kind: 'payRates' }),
  pick('Payroll', { kind: 'payroll', only: ['Detail'], split: 'year' }),
  // When each late cancel really happened, and who did it. One file per month from the start, since a
  // whole year is refused.
  pick('Cancellations', { kind: 'cancellations', only: ['Individual records'], split: 'month' }),
  // Which past classes the studio called off, so they arrive cancelled rather than live and Unpriced.
  // Its lines repeat some Individual records, grouped by class; it is small enough for one file.
  pick('Cancellations', { kind: 'groupCancellations', only: ['Group cancellations'] }),
  // Not read by the transform: who is on an autopay, to stop in Mindbody and re-sign on the platform.
  pick('Membership', { only: ['New Version Detail'], optional: true }),
  {
    // Reports -> Payment Processing -> Autopay Detail (Mindbody has no "AutoPay Schedule" report): every
    // autopay run due from today to 12 months ahead, POS-charged ones included. The other two filters
    // narrow ("Only account autopays", "Only auto-renewing"), so they stay off. Read only: the page's
    // Run / Delete buttons set frmDelEFT or a run flag, which this export never does.
    // A studio with no autopays gets the page's "No autopay transactions found" table.
    // The transform lists each in the preflight, and imports none; optional, so it can be added to a
    // cutover folder afterwards without moving its as-of moment.
    name: 'Autopay Detail', kind: 'autopay', cat: 'Sales', num: 43, optional: true, type: 'legacy',
    path: '/ASP/adm/adm_eft_det.asp',
    set: { requiredtxtDateStart: '$TODAY', requiredtxtDateEnd: '$FUTURE1Y', optEFTLocation: '-1', optPayMeth: '',
      pos_sales: true, optAccountAutoPay: false, optAutoRenewing: false, optFilterTagged: false,
      noOfRowsToDisplay: '100000' }, // the on-screen page size, set high so no page limit can cut the export
    variants: [{ label: 'Scheduled', set: { optEFTStatus: '1' } }],
  },
]
