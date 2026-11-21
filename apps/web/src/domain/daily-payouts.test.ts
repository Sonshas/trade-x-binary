import { describe, expect, it } from 'vitest'
import { emptyDailyPayoutDay, groupDailyPayouts, isIsoDate, manualReceiptPrefix, nairobiDate, shiftIsoDate } from './daily-payouts'

describe('daily payouts', () => {
  it('groups by Nairobi calendar date', () => {
    const days = groupDailyPayouts([
      { status: 'PENDING', amount: 10, amountKes: 1300, createdAt: '2026-10-24T21:30:00.000Z' },
      { status: 'COMPLETED', amount: 20, amountKes: 2600, createdAt: '2026-10-24T08:00:00.000Z' },
      { status: 'FAILED', amount: 5, amountKes: 650, createdAt: '2026-10-23T10:00:00.000Z' },
    ])
    expect(nairobiDate('2026-10-24T21:30:00.000Z')).toBe('2026-10-25')
    expect(days[0]).toMatchObject({ date: '2026-10-25', pendingCount: 1, pendingUsd: 10, requestedCount: 1 })
    expect(days[1]).toMatchObject({ date: '2026-10-24', paidCount: 1, paidUsd: 20, requestedCount: 1 })
    expect(days[2]).toMatchObject({ date: '2026-10-23', failedCount: 1, failedUsd: 5 })
  })

  it('builds operator receipt prefixes and accepts ISO dates', () => {
    expect(isIsoDate('2026-10-24')).toBe(true)
    expect(isIsoDate('24/10/2026')).toBe(false)
    expect(manualReceiptPrefix('2026-10-24')).toBe('MANUAL-261024')
  })

  it('shifts Nairobi calendar dates and returns an empty day', () => {
    expect(shiftIsoDate('2026-10-24', -1)).toBe('2026-10-23')
    expect(shiftIsoDate('2026-10-31', 1)).toBe('2026-11-01')
    expect(emptyDailyPayoutDay('2026-10-25')).toMatchObject({ date: '2026-10-25', requestedCount: 0, paidUsd: 0 })
  })
})
