import { getSupabase } from '@/lib/supabase'
import { edgeErrorMessage } from '@/services/system-issues'

const FUNCTION = 'admin-users'

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function invoke<T>(body: Record<string, unknown>): Promise<Result<T>> {
  const client = getSupabase()
  if (!client) return { ok: false, error: 'Supabase is not configured.' }
  const action = String(body.action ?? 'unknown')
  const { data, error } = await client.functions.invoke<Record<string, unknown>>(FUNCTION, {
    method: 'POST',
    body,
  })
  if (error) {
    const context = (error as { context?: Response }).context
    const status = context?.status
    if (status === 401 || status === 403) {
      try {
        const payload = (await context!.clone().json()) as { error?: string }
        return { ok: false, error: payload.error || 'Forbidden' }
      } catch {
        return { ok: false, error: 'Forbidden' }
      }
    }
    return {
      ok: false,
      error: await edgeErrorMessage(error, 'Admin request failed.', {
        area: 'admin',
        operation: `admin-users.${action}`,
      }),
    }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: await edgeErrorMessage(new Error('Empty admin-users response'), 'Admin request failed.', {
      area: 'admin',
      operation: `admin-users.${action}`,
    }) }
  }
  if (typeof (data as { error?: string }).error === 'string') {
    return { ok: false, error: String((data as { error: string }).error) }
  }
  return { ok: true, data: data as T }
}

export interface AdminUserListRow {
  id: string
  email: string | null
  name: string | null
  phone: string
  country: string
  role: string
  account_status: string
  live_trading_enabled: boolean
  deposits_enabled: boolean
  withdrawals_enabled: boolean
  win_rate_percent: number | null
  is_vip: boolean
  withdraw_gates_cleared: boolean
  kyc_status: string
  created_at: string
  available_usd: number
  locked_usd: number
  balance_usd: number
  collected_usd: number
  collected_kes: number
  collected_count: number
  open_withdrawals: number
  pending_deposits: number
  trade_count: number
}

export interface AdminDailyDepositRow {
  id: string
  userId: string
  userEmail: string | null
  userName: string | null
  phone: string | null
  amountUsd: number
  amountKes: number
  recordedKes: number | null
  status: string
  payment: string
  receipt: string | null
  provider: string | null
  createdAt: string
  creditedAt: string | null
}

export interface AdminDailyDeposits {
  date: string
  kesPerUsd: number
  rateSource: string
  completedCount: number
  completedUsd: number
  completedKes: number
  walletCount: number
  walletUsd: number
  walletKes: number
  feeCount: number
  feeUsd: number
  feeKes: number
  pendingCount: number
  pendingUsd: number
  pendingKes: number
  failedCount: number
  failedUsd: number
  failedKes: number
  deposits: AdminDailyDepositRow[]
  hasMore?: boolean
}

type AdminDailyDepositsRaw = Record<string, unknown>

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function mapDailyDeposits(raw: AdminDailyDepositsRaw): AdminDailyDeposits {
  const rows = Array.isArray(raw.deposits) ? raw.deposits : []
  return {
    date: text(raw.date) ?? '',
    kesPerUsd: num(raw.kes_per_usd),
    rateSource: text(raw.rate_source) ?? '',
    completedCount: num(raw.completed_count),
    completedUsd: num(raw.completed_usd),
    completedKes: num(raw.completed_kes),
    walletCount: num(raw.completed_wallet_count),
    walletUsd: num(raw.completed_wallet_usd),
    walletKes: num(raw.completed_wallet_kes),
    feeCount: num(raw.completed_fee_count),
    feeUsd: num(raw.completed_fee_usd),
    feeKes: num(raw.completed_fee_kes),
    pendingCount: num(raw.pending_count),
    pendingUsd: num(raw.pending_usd),
    pendingKes: num(raw.pending_kes),
    failedCount: num(raw.failed_count),
    failedUsd: num(raw.failed_usd),
    failedKes: num(raw.failed_kes),
    hasMore: raw.has_more === true,
    deposits: rows.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      const recorded = row.recorded_kes == null || row.recorded_kes === '' ? null : num(row.recorded_kes)
      return [{
        id: String(row.id ?? ''),
        userId: String(row.user_id ?? ''),
        userEmail: text(row.user_email),
        userName: text(row.user_name),
        phone: text(row.phone),
        amountUsd: num(row.amount_usd),
        amountKes: num(row.amount_kes),
        recordedKes: recorded,
        status: String(row.status ?? ''),
        payment: String(row.payment ?? 'Deposit'),
        receipt: text(row.receipt),
        provider: text(row.provider),
        createdAt: String(row.created_at ?? ''),
        creditedAt: text(row.credited_at),
      }]
    }),
  }
}


export const adminUsersService = {
  list: () => invoke<{ users: AdminUserListRow[] }>({ action: 'list' }),
  get: (userId: string) => invoke<Record<string, unknown>>({ action: 'get', user_id: userId }),
  update: (userId: string, patch: Record<string, unknown>) =>
    invoke<{ ok: boolean }>({ action: 'update', user_id: userId, ...patch }),
  adjustBalance: (userId: string, amount: number, note: string) =>
    invoke<{ ok: boolean; wallet?: Record<string, unknown> }>({
      action: 'adjust_balance',
      user_id: userId,
      amount,
      note,
    }),
  notify: (userId: string, title: string, message: string) =>
    invoke<{ ok: boolean }>({ action: 'notify', user_id: userId, title, body: message }),
  auditList: (userId?: string) =>
    invoke<{ rows: Record<string, unknown>[] }>({ action: 'audit_list', user_id: userId }),
  marketsList: () => invoke<{ markets: Record<string, unknown>[] }>({ action: 'markets_list' }),
  marketsUpdate: (symbol: string, patch: Record<string, unknown>) =>
    invoke<{ ok: boolean }>({ action: 'markets_update', symbol, ...patch }),
  serviceFees: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'service_fees' }),
  stkQueue: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'stk_queue' }),
  megapayEvents: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'megapay_events' }),
  depositsList: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'deposits_list' }),
  async depositsDaily(date?: string, page = 1): Promise<Result<AdminDailyDeposits>> {
    const result = await invoke<AdminDailyDepositsRaw>({
      action: 'deposits_daily',
      date: date || undefined,
      page,
      page_size: 20,
    })
    if (!result.ok) return result
    return { ok: true, data: mapDailyDeposits(result.data) }
  },
  tradesList: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'trades_list' }),
  ledgerList: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'ledger_list' }),
  supportList: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'support_list' }),
  supportReply: (ticketId: string, message: string) =>
    invoke<{ ok: boolean }>({ action: 'support_reply', ticket_id: ticketId, message }),
  supportClose: (ticketId: string) => invoke<{ ok: boolean }>({ action: 'support_close', ticket_id: ticketId }),
  notificationsList: () => invoke<{ rows: Record<string, unknown>[] }>({ action: 'notifications_list' }),
  notifyBroadcast: (title: string, body: string) =>
    invoke<{ ok: boolean; count?: number }>({ action: 'notify_broadcast', title, body }),
}
