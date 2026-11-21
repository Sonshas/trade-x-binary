import { describe, expect, it } from 'vitest'
import {
  adminDailyEarnings,
  dailyDepositKes,
  emptyDailyDepositDay,
  isIsoDate,
  nairobiDate,
  shiftIsoDate,
  summarizeDailyDeposits,
} from './daily-deposits'

describe('daily deposits', () => {
  it('groups completed / pending / failed by Nairobi calendar date', () => {
    const day = summarizeDailyDeposits(
      [
        { status: 'COMPLETED', amountUsd: 10, createdAt: '2026-10-24T21:30:00.000Z' },
        { status: 'PENDING', amountUsd: 5, createdAt: '2026-10-24T21:45:00.000Z' },
        { status: 'FAILED', amountUsd: 2, createdAt: '2026-10-24T22:00:00.000Z' },
        { status: 'COMPLETED', amountUsd: 20, createdAt: '2026-10-24T08:00:00.000Z' },
      ],
      '2026-10-25',
    )
    expect(nairobiDate('2026-10-24T21:30:00.000Z')).toBe('2026-10-25')
    expect(day).toMatchObject({
      date: '2026-10-25',
      completedCount: 1,
      completedUsd: 10,
      completedKes: 0,
      pendingCount: 1,
      pendingUsd: 5,
      failedCount: 1,
      failedUsd: 2,
    })
  })

  it('counts recorded KES and splits wallet deposits from scanner fees', () => {
    const day = summarizeDailyDeposits(
      [
        { status: 'COMPLETED', amountUsd: 12.31, amountKes: 1600, createdAt: '2026-11-13T21:30:00.000Z' },
        {
          status: 'COMPLETED',
          amountUsd: 50,
          amountKes: 6700,
          createdAt: '2026-11-13T22:00:00.000Z',
          fee: true,
        },
        { status: 'CANCELLED', amountUsd: 99, amountKes: 9999, createdAt: '2026-11-13T22:30:00.000Z' },
        { status: 'FAILED', amountUsd: 10, amountKes: 1300, createdAt: '2026-11-13T23:00:00.000Z' },
        {
          status: 'FAILED',
          amountUsd: 20,
          amountKes: 2600,
          createdAt: '2026-11-13T16:41:16.000Z',
          paidAt: '2026-11-14T07:50:06.000Z',
          receipt: 'UKDPQ2344Q',
        },
      ],
      '2026-11-14',
    )
    expect(day).toMatchObject({
      completedCount: 3,
      completedUsd: 82.31,
      completedKes: 10900,
      walletCount: 2,
      walletUsd: 32.31,
      walletKes: 4200,
      feeCount: 1,
      feeUsd: 50,
      feeKes: 6700,
    })
  })

  it('converts USD at the Superadmin deposit rate', () => {
    expect(dailyDepositKes(10, 130)).toBe(1300)
    expect(dailyDepositKes(0.5, 130)).toBe(65)
    expect(dailyDepositKes(10, null)).toBeNull()
  })

  it('shifts Nairobi dates and ignores non-ISO values', () => {
    expect(isIsoDate('2026-10-25')).toBe(true)
    expect(shiftIsoDate('2026-10-25', -1)).toBe('2026-10-24')
    expect(emptyDailyDepositDay('2026-10-25').completedCount).toBe(0)
  })

  it('splits earned money 50/50 and deducts 3.5% from each admin', () => {
    const [sonshas, benjamin] = adminDailyEarnings(1000, 130000)
    expect(sonshas).toMatchObject({
      email: 'sonshasopunga@gmail.com',
      role: 'superadmin',
      shareUsd: 500,
      deductionUsd: 17.5,
      finalUsd: 482.5,
      shareKes: 65000,
      deductionKes: 2275,
      finalKes: 62725,
    })
    expect(benjamin).toMatchObject({
      email: 'benjaminochieng310@gmail.com',
      role: 'admin',
      finalUsd: 482.5,
      finalKes: 62725,
    })
  })
})
