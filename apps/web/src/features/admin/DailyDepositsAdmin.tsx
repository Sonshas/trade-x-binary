import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Input, Stat } from '@/components/ui'
import { adminDailyEarnings, emptyDailyDepositDay, isIsoDate, nairobiDate, shiftIsoDate } from '@/domain/daily-deposits'
import { useAuthSession } from '@/hooks/useAuth'
import { formatMoney } from '@/lib/format'
import { adminUsersService, type AdminDailyDeposits } from '@/services/admin-users'

function todayNairobi(): string {
  return nairobiDate(new Date().toISOString()) || new Date().toISOString().slice(0, 10)
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function statusTone(status: string): 'call' | 'put' | 'amber' | 'mist' {
  const value = status.toUpperCase()
  if (value === 'COMPLETED') return 'call'
  if (value === 'FAILED') return 'put'
  if (value === 'PROCESSING' || value === 'PENDING') return 'amber'
  return 'mist'
}

function kesText(kes: number | null | undefined): string {
  if (kes == null || !Number.isFinite(kes)) return 'KES —'
  return `KES ${kes.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`
}

function emptyDay(date: string): AdminDailyDeposits {
  const totals = emptyDailyDepositDay(date)
  return {
    date,
    kesPerUsd: 0,
    rateSource: '',
    completedCount: totals.completedCount,
    completedUsd: totals.completedUsd,
    completedKes: totals.completedKes,
    walletCount: totals.walletCount,
    walletUsd: totals.walletUsd,
    walletKes: totals.walletKes,
    feeCount: totals.feeCount,
    feeUsd: totals.feeUsd,
    feeKes: totals.feeKes,
    pendingCount: totals.pendingCount,
    pendingUsd: totals.pendingUsd,
    pendingKes: 0,
    failedCount: totals.failedCount,
    failedUsd: totals.failedUsd,
    failedKes: 0,
    deposits: [],
  }
}

export function DailyDepositsAdmin() {
  const { isSignedIn } = useAuthSession()
  const [date, setDate] = useState(todayNairobi)
  const [data, setData] = useState<AdminDailyDeposits | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadTicket = useRef(0)

  const load = useCallback(async (nextDate = date) => {
    const ticket = ++loadTicket.current
    setLoading(true)
    setError(null)
    try {
      const first = await adminUsersService.depositsDaily(nextDate, 1)
      if (ticket !== loadTicket.current) return
      if (!first.ok) {
        setError(first.error)
        return
      }
      setData(first.data)
      let page = 1
      let hasMore = first.data.hasMore === true
      while (hasMore && page < 80) {
        page += 1
        const next = await adminUsersService.depositsDaily(nextDate, page)
        if (ticket !== loadTicket.current) return
        if (!next.ok) break
        hasMore = next.data.hasMore === true
        setData((prev) =>
          prev && prev.date === next.data.date
            ? { ...prev, deposits: [...prev.deposits, ...next.data.deposits], hasMore }
            : next.data,
        )
      }
    } catch (err) {
      if (ticket !== loadTicket.current) return
      setError(err instanceof Error && err.message ? err.message : 'Could not load daily deposits.')
    } finally {
      if (ticket === loadTicket.current) setLoading(false)
    }
  }, [date])

  useEffect(() => {
    if (isSignedIn) void load()
  }, [isSignedIn, load])

  async function openDay(next: string) {
    if (!isIsoDate(next)) return
    setDate(next)
    await load(next)
  }

  if (!isSignedIn) {
    return <Alert tone="mist">Sign in with an admin account to see daily deposits.</Alert>
  }

  const selected = data && data.date === date ? data : emptyDay(date)
  const rate = selected.kesPerUsd > 0 ? selected.kesPerUsd : data?.kesPerUsd
  const rateHint = rate ? `${rate} KES / USD (deposit rate)` : 'KES rate unavailable'

  return (
    <div className="space-y-4" data-testid="daily-deposits-admin">
      <div className="rounded-xl border border-line bg-ink-2/60 p-3" data-testid="daily-deposits-date-picker">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[13.5rem]">
            <Input
              label="Show day earnings"
              hint="Africa/Nairobi calendar date"
              type="date"
              value={date}
              onChange={(e) => void openDay(e.target.value)}
              data-testid="daily-deposits-date"
            />
          </div>
          <Button type="button" variant="secondary" onClick={() => void openDay(shiftIsoDate(date, -1))} disabled={loading}>
            Previous
          </Button>
          <Button type="button" variant="secondary" onClick={() => void openDay(todayNairobi())} disabled={loading || date === todayNairobi()}>
            Today
          </Button>
          <Button type="button" variant="secondary" onClick={() => void openDay(shiftIsoDate(date, 1))} disabled={loading}>
            Next
          </Button>
          <Button type="button" variant="secondary" onClick={() => void load(date)} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <section className="space-y-2" data-testid="daily-deposits-earnings">
        <div>
          <h2 className="font-display text-lg font-semibold text-paper">Amount earned {dayLabel(date)}</h2>
          <p className="text-xs text-mist">
            {selected.completedCount === 0 && selected.pendingCount === 0 && selected.failedCount === 0
              ? `No deposits on ${dayLabel(date)}`
              : `${selected.completedCount} M-Pesa receipt${selected.completedCount === 1 ? '' : 's'} this Nairobi day`}
            {' · '}
            Member deposits {formatMoney(selected.walletUsd)} ({kesText(selected.walletKes)}, {selected.walletCount})
            {' · '}
            Scanner / tax / verification fees {formatMoney(selected.feeUsd)} ({kesText(selected.feeKes)}, {selected.feeCount})
            {' · '}
            {rateHint}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-testid="daily-deposits-totals">
          <Stat
            label="Amount earned"
            value={formatMoney(selected.completedUsd)}
            subValue={kesText(selected.completedKes)}
            hint={`${selected.completedCount} received · recorded M-Pesa KES`}
            tone="live"
          />
          <Stat
            label="Pending"
            value={formatMoney(selected.pendingUsd)}
            subValue={kesText(selected.pendingKes)}
            hint={`${selected.pendingCount} pending`}
          />
          <Stat
            label="Failed"
            value={formatMoney(selected.failedUsd)}
            subValue={kesText(selected.failedKes)}
            hint={`${selected.failedCount} failed`}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2" data-testid="daily-admin-shares">
          {adminDailyEarnings(selected.completedUsd, selected.completedKes ?? 0).map((admin) => (
            <Stat
              key={admin.email}
              label={`${admin.name} final`}
              value={formatMoney(admin.finalUsd)}
              subValue={kesText(admin.finalKes)}
              hint={`${admin.role === 'superadmin' ? 'Superadmin' : 'Admin'} · 50% share ${formatMoney(admin.shareUsd)} minus 3.5% (${formatMoney(admin.deductionUsd)})`}
              tone="live"
            />
          ))}
        </div>
      </section>

      {selected.deposits.length > 0 ? (
        <div className="overflow-x-auto" data-testid="daily-deposits-rows">
          <p className="mb-2 text-xs font-semibold uppercase text-mist">
            {dayLabel(date)} — {selected.deposits.length} payment{selected.deposits.length === 1 ? '' : 's'} that reached M-Pesa (unpaid failed/cancelled STKs excluded)
          </p>
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs uppercase text-mist">
              <tr>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {selected.deposits.map((row) => (
                <tr key={row.id} className="border-t border-line/60">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{row.userName?.trim() || row.userEmail || row.userId}</span>
                    <span className="mt-0.5 block font-mono text-xs text-mist">{row.phone ?? '—'}</span>
                    <span className="mt-0.5 block text-xs text-mist">{row.payment}</span>
                  </td>
                  <td className="py-2 pr-3">
                    {formatMoney(row.amountUsd)}
                    <span className="mt-0.5 block text-xs text-mist">{kesText(row.amountKes)}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                  </td>
                  <td className="py-2 font-mono text-xs">{row.receipt ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !loading && !error ? (
        <p className="text-sm text-mist">No deposits recorded on {dayLabel(date)}.</p>
      ) : null}
    </div>
  )
}
