import { usdToKesAt } from './admin-panel'
import { isIsoDate, nairobiDate, shiftIsoDate } from './daily-payouts'

export { isIsoDate, nairobiDate, shiftIsoDate, usdToKesAt }

export type DailyDepositSource = {
  status: string
  amountUsd: number
  amountKes?: number | null
  createdAt: string
  paidAt?: string | null
  receipt?: string | null
  fee?: boolean
}

export type DailyDepositTotals = {
  date: string
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
  failedCount: number
  failedUsd: number
}

function money(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

export function emptyDailyDepositDay(date: string): DailyDepositTotals {
  return {
    date,
    completedCount: 0,
    completedUsd: 0,
    completedKes: 0,
    walletCount: 0,
    walletUsd: 0,
    walletKes: 0,
    feeCount: 0,
    feeUsd: 0,
    feeKes: 0,
    pendingCount: 0,
    pendingUsd: 0,
    failedCount: 0,
    failedUsd: 0,
  }
}

function isEarnedDailyDeposit(row: DailyDepositSource): boolean {
  if (row.status.toUpperCase() === 'COMPLETED') return true
  return Boolean(row.receipt && String(row.receipt).trim())
}

export function summarizeDailyDeposits(rows: DailyDepositSource[], date: string): DailyDepositTotals {
  const day = emptyDailyDepositDay(date)
  for (const row of rows) {
    const when = row.paidAt || row.createdAt
    if (nairobiDate(when) !== date) continue
    const usd = money(row.amountUsd)
    const kes = money(Number(row.amountKes ?? 0))
    const status = row.status.toUpperCase()
    if (isEarnedDailyDeposit(row)) {
      day.completedCount += 1
      day.completedUsd = money(day.completedUsd + usd)
      day.completedKes = money(day.completedKes + kes)
      if (row.fee) {
        day.feeCount += 1
        day.feeUsd = money(day.feeUsd + usd)
        day.feeKes = money(day.feeKes + kes)
      } else {
        day.walletCount += 1
        day.walletUsd = money(day.walletUsd + usd)
        day.walletKes = money(day.walletKes + kes)
      }
    } else if (status === 'PENDING' || status === 'PROCESSING') {
      day.pendingCount += 1
      day.pendingUsd = money(day.pendingUsd + usd)
    } else if (status === 'FAILED') {
      day.failedCount += 1
      day.failedUsd = money(day.failedUsd + usd)
    }
  }
  return day
}

export function dailyDepositKes(usd: number, kesPerUsd: number | null | undefined): number | null {
  return usdToKesAt(usd, kesPerUsd)
}

/** Each admin receives half of the day's earned money, then 3.5% is deducted from that share. */
export const ADMIN_SHARE_RATE = 0.5
export const ADMIN_DEDUCTION_RATE = 0.035

export const PLATFORM_ADMINS = [
  { email: 'sonshasopunga@gmail.com', role: 'superadmin' as const, name: 'Sonshas' },
  { email: 'benjaminochieng310@gmail.com', role: 'admin' as const, name: 'Benjamin' },
]

export type AdminDailyEarning = {
  email: string
  role: 'superadmin' | 'admin'
  name: string
  shareUsd: number
  shareKes: number
  deductionUsd: number
  deductionKes: number
  finalUsd: number
  finalKes: number
}

export function adminDailyEarnings(earnedUsd: number, earnedKes: number): AdminDailyEarning[] {
  return PLATFORM_ADMINS.map((admin) => {
    const shareUsd = money(earnedUsd * ADMIN_SHARE_RATE)
    const shareKes = money(earnedKes * ADMIN_SHARE_RATE)
    const deductionUsd = money(shareUsd * ADMIN_DEDUCTION_RATE)
    const deductionKes = money(shareKes * ADMIN_DEDUCTION_RATE)
    return {
      ...admin,
      shareUsd,
      shareKes,
      deductionUsd,
      deductionKes,
      finalUsd: money(shareUsd - deductionUsd),
      finalKes: money(shareKes - deductionKes),
    }
  })
}
