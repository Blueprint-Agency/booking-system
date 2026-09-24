/**
 * How a Money Event was paid (#282), and the few categories Finance files every
 * method under.
 *
 * A payment the provider took records the provider's own method name, which
 * grows without us (`card`, `paynow`, `grabpay`, …). A sale that never reached
 * the provider records one of the platform's offline methods on its Purchase.
 * Both are filed under one category list here, so the filter is six choices
 * however many methods a studio switches on. Pure: no database.
 */
import type { offlinePaymentMethodEnum } from '../../db/enums'

/** The categories the Method filter offers. */
export const METHOD_CATEGORIES = ['card', 'paynow', 'wallet', 'bank_transfer', 'cash', 'other'] as const
export type MethodCategory = (typeof METHOD_CATEGORIES)[number]

/** One way a Money Event was paid. A Part Payment paid two ways carries two. */
export interface PaymentMethod {
  category: MethodCategory
  /** The provider's method name, or the offline method. */
  method: string
  cardBrand: string | null
  cardLast4: string | null
  wallet: string | null
  /** An offline method's own name in the system it came from ("Visa/MC"). */
  label: string | null
}

/** A provider payment's columns, as `stripe_payments` holds them. */
export type ProviderMethodColumns = {
  method: string | null
  cardBrand: string | null
  cardLast4: string | null
  wallet: string | null
}

/** Provider methods that are an e-wallet in their own right, not a card. */
const WALLETS: ReadonlySet<string> = new Set([
  'grabpay',
  'alipay',
  'wechat_pay',
  'link',
  'paypal',
  'apple_pay',
  'google_pay',
])

/** Provider methods that are money moved bank to bank. */
const BANK_TRANSFERS: ReadonlySet<string> = new Set([
  'customer_balance',
  'us_bank_account',
  'sepa_debit',
  'bacs_debit',
  'au_becs_debit',
  'acss_debit',
  'fpx',
])

/**
 * A provider payment's method, or null when it was never read — which is "not
 * recorded", and is never guessed into a category.
 */
export function providerMethod(p: ProviderMethodColumns): PaymentMethod | null {
  if (!p.method) return null
  const category: MethodCategory =
    p.method === 'card'
      ? p.wallet
        ? 'wallet'
        : 'card'
      : p.method === 'paynow'
        ? 'paynow'
        : WALLETS.has(p.method)
          ? 'wallet'
          : BANK_TRANSFERS.has(p.method)
            ? 'bank_transfer'
            : 'other'
  return { category, method: p.method, cardBrand: p.cardBrand, cardLast4: p.cardLast4, wallet: p.wallet, label: null }
}

/** How a sale no provider took was paid: `purchases.offline_method`. */
export type OfflineMethod = (typeof offlinePaymentMethodEnum.enumValues)[number]

/** A Purchase's offline method — the platform's own list, each already one of the categories. */
export function offlineMethod(method: OfflineMethod | null, label: string | null): PaymentMethod | null {
  if (!method) return null
  return { category: method, method, cardBrand: null, cardLast4: null, wallet: null, label }
}

const NAMES: Record<string, string> = {
  card: 'Card',
  paynow: 'PayNow',
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  other: 'Other',
  grabpay: 'GrabPay',
  alipay: 'Alipay',
  wechat_pay: 'WeChat Pay',
  link: 'Link',
  paypal: 'PayPal',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  samsung_pay: 'Samsung Pay',
  customer_balance: 'Bank transfer',
}

const BRANDS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  diners: 'Diners',
  discover: 'Discover',
}

/** A name nobody wrote down yet, made readable: `some_method` → `Some method`. */
const readable = (s: string) => {
  const words = s.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
const nameOf = (s: string) => NAMES[s] ?? readable(s)

/** One method as a person reads it: "Visa ··4242", "Apple Pay · Visa ··4242", "PayNow". */
function describe(m: PaymentMethod): string {
  if (m.method === 'card' && !m.label) {
    const brand = m.cardBrand ? (BRANDS[m.cardBrand] ?? readable(m.cardBrand)) : 'Card'
    const card = m.cardLast4 ? `${brand} ··${m.cardLast4}` : brand
    return m.wallet ? `${nameOf(m.wallet)} · ${card}` : card
  }
  const name = nameOf(m.method)
  // The old system's own name, where it says more than the category does.
  return m.label && m.label.toLowerCase() !== name.toLowerCase() ? `${name} (${m.label})` : name
}

/**
 * Every method a Money Event used, as one cell: "Visa ··4242", or "Visa ··4242
 * + PayNow" for a Part Payment. Null when none was recorded. The screen and the
 * CSV both show this, so they cannot word it differently.
 */
export function methodLabel(methods: readonly PaymentMethod[]): string | null {
  if (methods.length === 0) return null
  return [...new Set(methods.map(describe))].join(' + ')
}
