import { describe, expect, it } from 'vitest'
import {
  depositPayRoute,
  parseDepositPayRoute,
  parseRailState,
  payRouteReady,
  railOrder,
  railToTry,
  railUpdate,
} from './deposit-rail'

const NOW = Date.parse('2026-10-27T08:40:00.000Z')

describe('deposit rail', () => {
  it('tries the Buy Goods till, then Daraja PayBill', () => {
    const recent = new Date(NOW - 30_000).toISOString()
    const order = ['daraja_till', 'daraja'] as const
    expect(railOrder(parseRailState({}), NOW, 'both')).toEqual(order)
    expect(railOrder(parseRailState({ DEPOSIT_ACTIVE_RAIL: 'daraja' }), NOW, 'both')).toEqual(order)
    expect(
      railOrder(parseRailState({ DEPOSIT_ACTIVE_RAIL: 'daraja_till', DEPOSIT_RAIL_CHECKED_AT: recent }), NOW, 'both'),
    ).toEqual(order)
  })

  it('sends one prompt: stop after acceptance or an ambiguous attempt, otherwise try the next rail', () => {
    const order = railOrder(parseRailState({}), NOW, 'both')
    expect(railToTry(order, [])).toBe('daraja_till')
    expect(railToTry(order, [{ rail: 'daraja_till', ok: true }])).toBeNull()
    expect(railToTry(order, [{ rail: 'daraja_till', ok: false, ambiguous: true }])).toBeNull()
    expect(railToTry(order, [{ rail: 'daraja_till', ok: false }])).toBe('daraja')
    expect(railToTry(order, [{ rail: 'daraja_till', ok: false, ambiguous: true }])).toBeNull()
    expect(
      railToTry(order, [
        { rail: 'daraja_till', ok: false },
        { rail: 'daraja', ok: true },
      ]),
    ).toBeNull()
    expect(
      railToTry(order, [
        { rail: 'daraja_till', ok: false },
        { rail: 'daraja', ok: false },
      ]),
    ).toBeNull()
  })

  it('records the last Daraja rail that was tried', () => {
    expect(railUpdate([{ rail: 'daraja', ok: false }], NOW)).toEqual({
      active: 'daraja',
      checkedAt: new Date(NOW).toISOString(),
    })
    expect(railUpdate([{ rail: 'daraja', ok: false }, { rail: 'daraja_till', ok: true }], NOW)).toEqual({
      active: 'daraja_till',
      checkedAt: new Date(NOW).toISOString(),
    })
  })

  it('reads the stored switch and treats a missing value as both', () => {
    expect(parseDepositPayRoute(' Paybill ')).toBe('paybill')
    expect(parseDepositPayRoute('daraja')).toBe('paybill')
    expect(parseDepositPayRoute('till')).toBe('till')
    expect(parseDepositPayRoute('both')).toBe('both')
    expect(parseDepositPayRoute('megapay')).toBe('paybill')
    expect(parseDepositPayRoute('other')).toBeNull()
    expect(depositPayRoute(undefined)).toBe('paybill_alt')
    expect(parseDepositPayRoute('paybill_alt')).toBe('paybill_alt')
    expect(parseDepositPayRoute('4088285')).toBe('paybill_alt')
    expect(payRouteReady('paybill', { paybill: false, paybillAlt: true, till: true })).toBe(false)
    expect(payRouteReady('paybill_alt', { paybill: true, paybillAlt: false, till: true })).toBe(false)
    expect(payRouteReady('till', { paybill: true, paybillAlt: true, till: false })).toBe(false)
    expect(payRouteReady('both', { paybill: false, paybillAlt: false, till: true })).toBe(true)
  })

  it('follows the admin switch: paybill, paybill_alt, till, or both', () => {
    const state = parseRailState({})
    expect(railOrder(state, NOW, 'paybill')).toEqual(['daraja'])
    expect(railOrder(state, NOW, 'paybill_alt')).toEqual(['daraja_alt'])
    expect(railOrder(state, NOW, 'till')).toEqual(['daraja_till'])
    expect(railOrder(state, NOW, 'both')).toEqual(['daraja_till', 'daraja'])
    expect(railToTry(railOrder(state, NOW, 'paybill'), [])).toBe('daraja')
    expect(railToTry(railOrder(state, NOW, 'paybill_alt'), [])).toBe('daraja_alt')
    expect(railToTry(railOrder(state, NOW, 'till'), [{ rail: 'daraja_till', ok: false }])).toBeNull()
    expect(railToTry(railOrder(state, NOW, 'paybill'), [{ rail: 'daraja', ok: false }])).toBeNull()
    expect(railToTry(railOrder(state, NOW, 'both'), [{ rail: 'daraja_till', ok: false }])).toBe('daraja')
  })
})
