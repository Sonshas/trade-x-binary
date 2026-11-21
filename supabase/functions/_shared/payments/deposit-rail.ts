// Canonical: apps/web/src/domain/payments/deposit-rail.ts
// Mirror: supabase/functions/_shared/payments/deposit-rail.ts (must stay byte-identical)
// One M-Pesa deposit, one prompt. Admin DEPOSIT_PAY_ROUTE chooses the Daraja rails:
// paybill — CustomerPayBillOnline (primary MPESA_SHORTCODE)
// paybill_alt — CustomerPayBillOnline (MPESA_ALT_* paybill, e.g. 4088285)
// till — CustomerBuyGoodsOnline (PartyB = MPESA_TILL)
// both — Till first, then primary Paybill
// The next rail runs only when the earlier one fails before a prompt is sent.

export const DEPOSIT_ACTIVE_RAIL = 'DEPOSIT_ACTIVE_RAIL'
export const DEPOSIT_RAIL_CHECKED_AT = 'DEPOSIT_RAIL_CHECKED_AT'
export const DEPOSIT_PAY_ROUTE = 'DEPOSIT_PAY_ROUTE'
export const RAIL_PROBE_MS = 2 * 60 * 1000

export type DepositRail = 'daraja' | 'daraja_till' | 'daraja_alt'
export type DepositPayRoute = 'paybill' | 'paybill_alt' | 'till' | 'both'

export interface RailState {
  active: DepositRail
  checkedAt: number | null
}

export interface RailHealthUpdate {
  active: DepositRail
  checkedAt: string
}

export interface RailAttempt {
  rail: DepositRail
  ok: boolean
  /** The request may already have been accepted. Do not start another prompt. */
  ambiguous?: boolean
}

export function parseDepositPayRoute(raw: string | undefined | null): DepositPayRoute | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value === 'paybill' || value === 'daraja') return 'paybill'
  if (value === 'paybill_alt' || value === 'paybill2' || value === 'alt' || value === '4088285') {
    return 'paybill_alt'
  }
  if (value === 'till' || value === 'daraja_till' || value === 'buygoods') return 'till'
  if (value === 'both') return 'both'
  // Old MegaPay-only setting collapses onto Paybill.
  if (value === 'megapay') return 'paybill'
  return null
}

/** Missing or unknown settings use Winsoft Daraja Paybill 4088285 (paybill_alt). */
export function depositPayRoute(raw: string | undefined | null): DepositPayRoute {
  return parseDepositPayRoute(raw) ?? 'paybill_alt'
}

export function railsForPayRoute(route: DepositPayRoute): DepositRail[] {
  if (route === 'paybill') return ['daraja']
  if (route === 'paybill_alt') return ['daraja_alt']
  if (route === 'till') return ['daraja_till']
  // Till first: this shortcode is Lipa Na M-Pesa Buy Goods. Paybill returns ResultCode 2029.
  return ['daraja_till', 'daraja']
}

export function payRouteReady(
  route: DepositPayRoute,
  ready: { paybill: boolean; paybillAlt: boolean; till: boolean },
): boolean {
  if (route === 'paybill') return ready.paybill
  if (route === 'paybill_alt') return ready.paybillAlt
  if (route === 'till') return ready.till
  return ready.paybill || ready.till
}

export function parseRailState(map: Record<string, string | undefined | null>): RailState {
  const raw = String(map[DEPOSIT_ACTIVE_RAIL] ?? '').trim().toLowerCase()
  const active: DepositRail =
    raw === 'daraja_till' ? 'daraja_till' : raw === 'daraja_alt' ? 'daraja_alt' : 'daraja'
  const checkedAt = Date.parse(String(map[DEPOSIT_RAIL_CHECKED_AT] ?? ''))
  return { active, checkedAt: Number.isFinite(checkedAt) ? checkedAt : null }
}

/** Rails for this deposit. Stored health does not reorder them. */
export function railOrder(state: RailState, now = Date.now(), route: DepositPayRoute = 'both'): DepositRail[] {
  void state
  void now
  return railsForPayRoute(route)
}

/**
 * Next rail for this deposit. Null after a checkout id is accepted, after an
 * ambiguous timeout, or when every rail has already been tried.
 */
export function railToTry(order: readonly DepositRail[], attempts: readonly RailAttempt[]): DepositRail | null {
  if (attempts.some((attempt) => attempt.ok || attempt.ambiguous)) return null
  const tried = new Set(attempts.map((attempt) => attempt.rail))
  return order.find((rail) => !tried.has(rail)) ?? null
}

/** Persist health after the first Daraja rail was tried. */
export function railUpdate(
  events: ReadonlyArray<{ rail: DepositRail; ok: boolean }>,
  now = Date.now(),
): RailHealthUpdate | null {
  const last = [...events]
    .reverse()
    .find((event) => event.rail === 'daraja' || event.rail === 'daraja_till' || event.rail === 'daraja_alt')
  if (!last) return null
  return {
    active: last.rail,
    checkedAt: new Date(now).toISOString(),
  }
}
