export type DailyPayoutSource = {
  status: string
  amount: number
  amountKes?: number | null
  createdAt: string
}

export type DailyPayoutDay = {
  date: string
  requestedCount: number
  requestedUsd: number
  requestedKes: number
  paidCount: number
  paidUsd: number
  paidKes: number
  pendingCount: number
  pendingUsd: number
  pendingKes: number
  failedCount: number
  failedUsd: number
}

export function nairobiDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' })
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function shiftIsoDate(date: string, days: number): string {
  if (!isIsoDate(date)) return date
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10)
}

export function emptyDailyPayoutDay(date: string): DailyPayoutDay {
  return emptyDay(date)
}

function money(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

function emptyDay(date: string): DailyPayoutDay {
  return {
    date,
    requestedCount: 0,
    requestedUsd: 0,
    requestedKes: 0,
    paidCount: 0,
    paidUsd: 0,
    paidKes: 0,
    pendingCount: 0,
    pendingUsd: 0,
    pendingKes: 0,
    failedCount: 0,
    failedUsd: 0,
  }
}

export function groupDailyPayouts(rows: DailyPayoutSource[]): DailyPayoutDay[] {
  const byDate = new Map<string, DailyPayoutDay>()
  for (const row of rows) {
    const date = nairobiDate(row.createdAt)
    if (!date) continue
    const day = byDate.get(date) ?? emptyDay(date)
    const usd = money(row.amount)
    const kes = money(Number(row.amountKes ?? 0))
    day.requestedCount += 1
    day.requestedUsd = money(day.requestedUsd + usd)
    day.requestedKes = money(day.requestedKes + kes)
    const status = row.status.toUpperCase()
    if (status === 'COMPLETED') {
      day.paidCount += 1
      day.paidUsd = money(day.paidUsd + usd)
      day.paidKes = money(day.paidKes + kes)
    } else if (status === 'PENDING' || status === 'PROCESSING') {
      day.pendingCount += 1
      day.pendingUsd = money(day.pendingUsd + usd)
      day.pendingKes = money(day.pendingKes + kes)
    } else if (status === 'FAILED') {
      day.failedCount += 1
      day.failedUsd = money(day.failedUsd + usd)
    }
    byDate.set(date, day)
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
}

export function manualReceiptPrefix(date: string): string {
  const compact = date.replaceAll('-', '').slice(2)
  return `MANUAL-${compact}`
}
