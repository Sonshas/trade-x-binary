export const DASHBOARD_ADMIN_ROLES = ['admin', 'superadmin', 'finance'] as const
/** @deprecated use DASHBOARD_ADMIN_ROLES */
export const DASHBOARD_STAFF_ROLES = DASHBOARD_ADMIN_ROLES

export function isDashboardAdminRole(role: string | null | undefined): boolean {
  if (!role) return false
  const trimmed = role.trim()
  return (DASHBOARD_ADMIN_ROLES as readonly string[]).includes(trimmed)
}

/** @deprecated use isDashboardAdminRole */
export function isDashboardStaffRole(role: string | null | undefined): boolean {
  return isDashboardAdminRole(role)
}

export interface DepositSource {
  id: string
  user_id: string
  amount: number | string | null
  currency: string | null
  status: string | null
  provider: string | null
  method: string | null
  mpesa_receipt: string | null
  callback_amount_kes: number | string | null
  callback_at?: string | null
  details: Record<string, unknown> | null
  created_at: string
  updated_at: string
  is_simulated: boolean
  account_mode: string | null
}

export interface DashboardDeposit {
  id: string
  user_id: string
  amount_usd: number | null
  amount_kes: number | null
  status: string
  provider: string | null
  payment: string
  receipt: string | null
  created_at: string
  paid_at: string | null
  credited_at: string | null
}

export interface CollectedTotals {
  usd: number | null
  kes: number | null
  count: number
}

export interface AuthUserSource {
  id: string
  email: string | null
  created_at: string
  app_role: string | null
}

export interface PublicUserSource {
  id: string
  email: string | null
  role: string | null
}

export interface DashboardUser {
  id: string
  email: string | null
  signed_up_at: string
  role: string
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function paymentLabel(kind: string | null, named: string | null): string {
  if (named) return named
  if (kind === 'verification') return 'Account verification'
  if (kind === 'scanner') return 'AI scanner'
  if (kind === 'tax') return 'Tax compliance'
  return 'Deposit'
}

export function isRealMpesaDeposit(row: DepositSource): boolean {
  return row.account_mode === 'real' && row.is_simulated === false && (row.method ?? '').toLowerCase() === 'mpesa'
}

export function isCompletedStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toUpperCase() === 'COMPLETED'
}

function parseMpesaTransactionDate(value: unknown): string | null {
  if (value == null || value === '') return null
  const raw = String(value).trim()
  if (/^\d{14}$/.test(raw)) {
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}+03:00`
    const parsed = Date.parse(iso)
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

function firstTransactionDate(value: unknown): string | null {
  if (value == null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstTransactionDate(item)
      if (found) return found
    }
    return null
  }
  const record = value as Record<string, unknown>
  for (const [key, nested] of Object.entries(record)) {
    if (key.toLowerCase() === 'transactiondate') {
      const found = parseMpesaTransactionDate(nested)
      if (found) return found
    }
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') {
      const found = firstTransactionDate(nested)
      if (found) return found
    }
  }
  return null
}

function firstReceiptText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^[A-Z0-9]{8,20}$/i.test(trimmed)) return trimmed
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstReceiptText(item)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const [key, nested] of Object.entries(record)) {
      const lower = key.toLowerCase()
      if (
        lower === 'mpesa_receipt' ||
        lower === 'transactionreceipt' ||
        lower === 'mpesareceiptnumber' ||
        lower === 'receiptnumber'
      ) {
        const found = firstReceiptText(nested)
        if (found) return found
      }
    }
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === 'object') {
        const found = firstReceiptText(nested)
        if (found) return found
      }
    }
  }
  return null
}

function resultCodeOf(row: DepositSource): string | null {
  const details = row.details ?? {}
  const confirmation = details.confirmation && typeof details.confirmation === 'object'
    ? (details.confirmation as Record<string, unknown>)
    : null
  const raw = details.result_code ?? details.ResultCode ?? confirmation?.ResultCode ?? confirmation?.result_code
  if (raw == null || raw === '') return null
  return String(raw).trim()
}

export function mpesaReceiptOf(row: Pick<DepositSource, 'mpesa_receipt' | 'details'>): string | null {
  return text(row.mpesa_receipt) ?? firstReceiptText(row.details)
}

export function depositPaymentAt(row: DepositSource): string {
  const details = row.details ?? {}
  const fromReceipt = firstTransactionDate(details)
  if (fromReceipt) return fromReceipt
  // Booked/credited time before callback_at so delayed repairs (FAILED then later COMPLETED)
  // land on the Nairobi day the money was recognized, not the abandoned STK row.
  const completed = text(details.completed_at)
  if (completed) return completed
  const callback = text(row.callback_at) ?? text(details.callback_at)
  if (callback) return callback
  const initiated = text(details.initiated_at)
  if (initiated) return initiated
  return row.created_at
}

export function isEarnedMpesaDeposit(row: DepositSource): boolean {
  if (!isRealMpesaDeposit(row)) return false
  if (mpesaReceiptOf(row)) return true
  if (resultCodeOf(row) === '0') return true
  return isCompletedStatus(row.status)
}

export function isServiceChargeDetails(details: Record<string, unknown> | null | undefined): boolean {
  if (!details) return false
  const type = text(details.type)
  const kind = text(details.kind)
  return type === 'service_charge' || kind === 'scanner' || kind === 'verification' || kind === 'tax'
}

export function resolvedDepositMoney(
  row: Pick<DashboardDeposit, 'amount_usd' | 'amount_kes'>,
  kesPerUsd: number,
): { usd: number; kes: number } {
  const rate = Number.isFinite(kesPerUsd) && kesPerUsd > 0 ? kesPerUsd : 0
  const usd =
    row.amount_usd != null
      ? row.amount_usd
      : row.amount_kes != null && rate > 0
        ? roundMoney(row.amount_kes / rate)
        : 0
  const kes = row.amount_kes != null ? roundMoney(row.amount_kes) : rate > 0 ? roundMoney(usd * rate) : 0
  return { usd, kes }
}

export function isCreditedDeposit(row: DepositSource): boolean {
  return isEarnedMpesaDeposit(row)
}

export function toDashboardDeposit(row: DepositSource): DashboardDeposit {
  const details = row.details ?? {}
  const currency = (row.currency ?? '').toUpperCase()
  const amount = finiteNumber(row.amount)
  const kesFromDetails = finiteNumber(details.amount_kes)
  const kesFromCallback = finiteNumber(row.callback_amount_kes)
  const amountKes = currency === 'KES' ? (kesFromCallback ?? kesFromDetails ?? amount) : (kesFromCallback ?? kesFromDetails)
  const amountUsd = currency === 'USD' ? amount : finiteNumber(details.amount_usd)
  const paidAt = depositPaymentAt(row)
  const earned = isEarnedMpesaDeposit(row)
  return {
    id: row.id,
    user_id: row.user_id,
    amount_usd: amountUsd,
    amount_kes: amountKes,
    status: row.status ?? '',
    provider: text(row.provider),
    payment: paymentLabel(text(details.kind), text(details.payment)),
    receipt: mpesaReceiptOf(row),
    created_at: row.created_at,
    paid_at: paidAt,
    credited_at: earned ? paidAt : null,
  }
}

export function splitMpesaDeposits(rows: DepositSource[]): { collected: DashboardDeposit[]; other: DashboardDeposit[] } {
  const collected: DashboardDeposit[] = []
  const other: DashboardDeposit[] = []
  for (const row of rows) {
    if (!isRealMpesaDeposit(row)) continue
    const view = toDashboardDeposit(row)
    if (isEarnedMpesaDeposit(row)) collected.push(view)
    else other.push(view)
  }
  return { collected, other }
}

export function collectedTotals(collected: DashboardDeposit[]): CollectedTotals {
  if (collected.length === 0) return { usd: 0, kes: 0, count: 0 }
  let usd = 0
  let kes = 0
  let hasUsd = false
  let hasKes = false
  for (const row of collected) {
    if (row.amount_usd != null) {
      usd += row.amount_usd
      hasUsd = true
    }
    if (row.amount_kes != null) {
      kes += row.amount_kes
      hasKes = true
    }
  }
  return {
    usd: hasUsd ? roundMoney(usd) : null,
    kes: hasKes ? roundMoney(kes) : null,
    count: collected.length,
  }
}

export function mergeJoinedUsers(authUsers: AuthUserSource[], profiles: PublicUserSource[]): DashboardUser[] {
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))
  const seen = new Set<string>()
  const merged: DashboardUser[] = []
  for (const authUser of authUsers) {
    if (!authUser.id || seen.has(authUser.id)) continue
    seen.add(authUser.id)
    const profile = profilesById.get(authUser.id)
    merged.push({
      id: authUser.id,
      email: text(authUser.email) ?? text(profile?.email),
      signed_up_at: authUser.created_at,
      role: text(authUser.app_role) ?? text(profile?.role) ?? 'trader',
    })
  }
  merged.sort((a, b) => {
    const at = Date.parse(a.signed_up_at)
    const bt = Date.parse(b.signed_up_at)
    const aOk = Number.isFinite(at)
    const bOk = Number.isFinite(bt)
    if (aOk && bOk && at !== bt) return bt - at
    if (aOk !== bOk) return aOk ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return merged
}
