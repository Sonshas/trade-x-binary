import { DEFAULT_DEPOSIT_PROVIDER, parseDepositProvider, type DepositProvider } from '@/domain/daraja'
import { depositPayRoute, type DepositPayRoute } from '@/domain/payments/deposit-rail'
import { parseMegapayConfig } from '@/domain/megapay'
import { raceWithTimeout, softTimeoutKeepGoing } from '@/lib/abort-timeout'
import { loadDemoSession } from '@/lib/demo-session'
import { hydratePayMode } from '@/lib/pay-mode'
import { getSupabase } from '@/lib/supabase'
import { readSavedHostFees } from '@/services/admin-fees'
import {
  UNAVAILABLE,
  errorMessage,
  mapState,
  type MegapayDepositConfig,
  type MegapayDepositState,
  type Result,
} from '@/services/megapay'

export interface DepositConfig extends MegapayDepositConfig {
  provider: DepositProvider
  paybill: string | null
  payRoute?: DepositPayRoute
}

export type DepositState = MegapayDepositState

const DARAJA_FUNCTIONS = { start: 'mpesa-deposit', status: 'mpesa-status' } as const
/** Config must not leave the deposit form on "Loading deposit options…". */
const CONFIG_BUDGET_MS = 5_000
const CONFIG_BUSY = 'Deposits are busy right now. Please try again.'

export function resolveDepositProvider(raw: unknown): DepositProvider {
  const provider = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).provider : undefined
  return typeof provider === 'string' ? parseDepositProvider(provider) : DEFAULT_DEPOSIT_PROVIDER
}

export function depositMethodLabel(config: Pick<DepositConfig, 'provider' | 'paybill' | 'payRoute'>): string {
  if (config.payRoute === 'till') return 'M-Pesa (Till)'
  if (config.payRoute === 'both') {
    return config.paybill ? `M-Pesa (Till, then Paybill ${config.paybill})` : 'M-Pesa (Till, then Paybill)'
  }
  if (config.payRoute === 'paybill_alt') {
    return config.paybill ? `M-Pesa (Paybill ${config.paybill})` : 'M-Pesa (Paybill 4088285)'
  }
  return config.paybill ? `M-Pesa (Paybill ${config.paybill})` : 'M-Pesa (Paybill)'
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** A provider-only body (`{ provider }`) has no enabled flag. Missing enabled is not a pause. */
export function depositConfigFromPayload(data: Record<string, unknown>, provider: DepositProvider): DepositConfig | null {
  if (typeof data.enabled !== 'boolean') return null
  const kesPerUsd = finiteNumber(data.kes_per_usd)
  const minKes = finiteNumber(data.min_kes)
  const maxKes = finiteNumber(data.max_kes)
  if (kesPerUsd == null || minKes == null || maxKes == null) return null
  const quick = Array.isArray(data.quick_amounts)
    ? data.quick_amounts.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    : undefined
  const payRoute = typeof data.pay_route === 'string' ? depositPayRoute(data.pay_route) : undefined
  const paybillNumber = typeof data.paybill === 'string' && data.paybill ? data.paybill : null
  return {
    provider,
    paybill: payRoute === 'till' ? null : paybillNumber,
    ...(payRoute ? { payRoute } : {}),
    enabled: data.enabled,
    kesPerUsd,
    minKes,
    maxKes,
    quickAmounts: quick && quick.length ? quick : undefined,
    message: typeof data.message === 'string' ? data.message : null,
  }
}

const depositConfigWatchers = new Set<(config: DepositConfig) => void>()

/** Applies a config that arrives after the soft timeout, without another edge call. */
export function subscribeDepositConfig(listener: (config: DepositConfig) => void): () => void {
  depositConfigWatchers.add(listener)
  return () => {
    depositConfigWatchers.delete(listener)
  }
}

function publishDepositConfig(config: DepositConfig) {
  for (const listener of depositConfigWatchers) listener(config)
}

/** A missed, timed-out, or broken config read is a usable form, not a pause. */
export function fallbackDepositConfig(): DepositConfig {
  const saved = readSavedHostFees()?.deposit
  const base = parseMegapayConfig({})
  const quick = (saved?.quickAmounts ?? '1600,2500,5000,10000')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((amount) => Number.isInteger(amount) && amount > 0)
  return {
    provider: 'daraja',
    paybill: '4088285',
    payRoute: 'paybill_alt',
    enabled: true,
    kesPerUsd: saved?.kesPerUsd ?? base.kesPerUsd,
    minKes: saved?.minKes ?? base.minKes,
    maxKes: saved?.maxKes ?? base.maxKes,
    quickAmounts: quick.length ? quick : undefined,
    message: null,
  }
}

function savedDepositConfig(): Result<DepositConfig> | null {
  if (!loadDemoSession()?.email) return null
  const saved = readSavedHostFees()?.deposit
  const base = parseMegapayConfig({})
  const quick = (saved?.quickAmounts ?? '1600,2500,5000,10000')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((amount) => Number.isInteger(amount) && amount > 0)
  return {
    ok: true,
    data: {
      provider: 'daraja',
      paybill: '4088285',
      payRoute: 'paybill_alt',
      enabled: true,
      kesPerUsd: saved?.kesPerUsd ?? base.kesPerUsd,
      minKes: saved?.minKes ?? base.minKes,
      maxKes: saved?.maxKes ?? base.maxKes,
      quickAmounts: quick.length ? quick : undefined,
      message: null,
    },
  }
}

export const depositService = {
  async getConfig(): Promise<Result<DepositConfig>> {
    const client = getSupabase()
    const usable = (): Result<DepositConfig> => savedDepositConfig() ?? { ok: true, data: fallbackDepositConfig() }
    if (!client) return usable()
    const invoke = (async (): Promise<Result<DepositConfig>> => {
      try {
        const { data, error } = await client.functions.invoke<Record<string, unknown>>(DARAJA_FUNCTIONS.start, { method: 'GET' })
        if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
          const message = await errorMessage(error)
          if (/sign in/i.test(message)) return { ok: false, error: message }
          return usable()
        }
        // Live deposits are locked to Daraja / mpesa-deposit (Winsoft paybill 4088285).
        const provider: DepositProvider = 'daraja'
        hydratePayMode(provider)
        const inline = depositConfigFromPayload(data, provider)
        if (!inline) return usable()
        return {
          ok: true,
          data: {
            ...inline,
            provider: 'daraja',
            payRoute: 'paybill_alt',
            paybill: inline.paybill || '4088285',
          },
        }
      } catch {
        return usable()
      }
    })()
    return softTimeoutKeepGoing(invoke, CONFIG_BUDGET_MS, usable(), (late: Result<DepositConfig>) => {
      if (late.ok) publishDepositConfig(late.data)
    })
  },

  async startDeposit(_provider: DepositProvider, amountKes: number, phone: string): Promise<Result<DepositState>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    try {
      return await raceWithTimeout(
        (async () => {
          const { data, error } = await client.functions.invoke<Record<string, unknown>>(DARAJA_FUNCTIONS.start, {
            method: 'POST',
            body: { amount_kes: amountKes, phone },
          })
          if (data && typeof data.error === 'string' && data.error.trim()) {
            return { ok: false as const, error: data.error.trim() }
          }
          if (error || !data) return { ok: false as const, error: await errorMessage(error) }
          if (!data.deposit_id) return { ok: false as const, error: UNAVAILABLE }
          return { ok: true as const, data: mapState(data) }
        })(),
        55_000,
        { ok: false as const, error: CONFIG_BUSY },
      )
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : CONFIG_BUSY }
    }
  },

  async checkStatus(_provider: DepositProvider, depositId: string): Promise<Result<DepositState>> {
    const client = getSupabase()
    if (!client) return { ok: false, error: UNAVAILABLE }
    const { data, error } = await client.functions.invoke<Record<string, unknown>>(DARAJA_FUNCTIONS.status, {
      method: 'POST',
      body: { deposit_id: depositId },
    })
    if (error || !data) return { ok: false, error: await errorMessage(error) }
    return { ok: true, data: mapState(data) }
  },
}
