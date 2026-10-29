/**
 * A Billing details address: which countries it may be in, and how
 * it reads, a line each. Pure, with no database import, so the Receipts CSV
 * (`receipts/csv.ts`) can read an address as the Receipt (`receipts/document.ts`)
 * does without building a pool.
 */

/** The address fields of a set, as stored and as a Purchase copies them. */
export interface BillingAddress {
  name: string
  line1: string
  line2: string | null
  city: string
  state: string | null
  postcode: string
  /** ISO 3166-1 alpha-2. */
  country: string
}

/**
 * Every code ISO 3166-1 alpha-2 assigns to a country or territory today: the
 * 249 officially assigned. Written out rather than asked of `Intl`, which also
 * names codes that are no country a set can be in: the EU (`EU`, `EZ`), the
 * UN, the Soviet Union and Yugoslavia (`SU`, `YU`), Kosovo's user-assigned
 * `XK`, and the reserved `AC`, `TA`, `IC`, `DG`, `EA`, `CP`, `UK` and `FX`.
 * fe-client keeps the same list for its country picker.
 */
export const COUNTRY_CODES: ReadonlySet<string> = new Set(
  (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ ' +
    'BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
    'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
    'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY ' +
    'HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
    'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY ' +
    'MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
    'NA NC NE NF NG NI NL NO NP NR NU NZ OM ' +
    'PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
    'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ ' +
    'TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ ' +
    'VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
  ).split(' '),
)

const REGIONS = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' })

/** A country's English name, from its code: the code itself where the runtime has no name for it. */
const countryName = (code: string): string => REGIONS.of(code) ?? code

/**
 * A Bill to's address as it prints, a line each: the two address lines, then
 * city, state and postcode together, then the country by its name. The same
 * reading as the member's Billing details page (fe-client `addressLines`).
 */
export const billToAddressLines = (bill: BillingAddress): string[] =>
  [bill.line1, bill.line2, [bill.city, bill.state, bill.postcode].filter(Boolean).join(' '), countryName(bill.country)].filter(
    (line): line is string => Boolean(line && line.trim()),
  )
