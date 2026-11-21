import { type DepositProvider } from './daraja.ts'
import { type DepositPayRoute } from './deposit-rail.ts'

export interface PayMode {
  id: DepositProvider
  label: string
  detail: string
  envKeys: readonly string[]
}

export interface DarajaRouteMode {
  id: DepositPayRoute
  label: string
  detail: string
}

export const PAY_MODES: readonly PayMode[] = [
  {
    id: 'daraja',
    label: 'Daraja',
    detail: 'Safaricom M-Pesa STK through a paybill or till.',
    envKeys: [
      'DEPOSIT_PROVIDER',
      'MPESA_CONSUMER_KEY',
      'MPESA_CONSUMER_SECRET',
      'MPESA_SHORTCODE',
      'MPESA_PASSKEY',
      'MPESA_CALLBACK_URL',
      'MPESA_ACCOUNT_REFERENCE',
    ],
  },
  {
    id: 'megapay',
    label: 'MegaPay',
    detail: 'MegaPay M-Pesa STK.',
    envKeys: [
      'DEPOSIT_PROVIDER',
      'MEGAPAY_API_KEY_WINSOFT',
      'MEGAPAY_API_KEY_VAST',
      'MEGAPAY_EMAIL',
    ],
  },
]

/** When Daraja is active, admin picks which shortcode / till rail to use. */
export const DARAJA_ROUTE_MODES: readonly DarajaRouteMode[] = [
  {
    id: 'paybill',
    label: 'Primary Paybill',
    detail: 'CustomerPayBillOnline with MPESA_SHORTCODE.',
  },
  {
    id: 'paybill_alt',
    label: 'Paybill 4088285',
    detail: 'CustomerPayBillOnline with MPESA_ALT_* credentials.',
  },
  {
    id: 'till',
    label: 'Till (Buy Goods)',
    detail: 'CustomerBuyGoodsOnline with MPESA_TILL.',
  },
  {
    id: 'both',
    label: 'Till + primary Paybill',
    detail: 'Try Till first, then primary Paybill.',
  },
]

export function isPayMode(value: string | undefined | null): value is DepositProvider {
  const id = String(value ?? '').trim().toLowerCase()
  return PAY_MODES.some((mode) => mode.id === id)
}

export function payModeById(id: DepositProvider): PayMode {
  return PAY_MODES.find((mode) => mode.id === id) ?? PAY_MODES[0]!
}

export function darajaRouteById(id: DepositPayRoute): DarajaRouteMode {
  return DARAJA_ROUTE_MODES.find((mode) => mode.id === id) ?? DARAJA_ROUTE_MODES.find((m) => m.id === 'paybill_alt')!
}
