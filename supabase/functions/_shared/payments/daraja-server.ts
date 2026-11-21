import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  DARAJA_PROVIDER,
  DEFAULT_DARAJA_CALLBACK_URL,
  DEFAULT_TRANSACTION_DESC,
  SWEEP_MIN_AGE_MS,
  accountReference,
  buildStkPushRequest,
  buildStkQueryRequest,
  type DarajaStkType,
  classifyStkQuery,
  darajaBaseUrl,
  decideDarajaSettlement,
  isOpenStatus,
  parseDepositProvider,
  shouldQueryNow,
  type CallbackEvidence,
  type DepositProvider,
  type StkQueryClassification,
} from './daraja.ts'
import { parseMegapayConfig, type MegapayConfig } from './megapay.ts'
import { depositFeesFromMap, mergeMegapayConfig, parseQuickAmounts } from './payment-settings.ts'
import { isServiceChargeDepositDetails, serviceKind } from '../service-charges.ts'
import { lookupUserEmail, notifyAdminsPaymentIssue, notifyAdminsPaymentReceived } from '../admin-payment-email.ts'
import { DEPOSIT_COLUMNS, loadPaymentSettingsMap, logEdgeError, type DepositRow } from '../server.ts'

/** Pending longer than this triggers one delay email (before expiry fail). */
const DELAY_NOTIFY_MS = 5 * 60 * 1000

export interface DarajaConfig extends MegapayConfig {
  provider: DepositProvider
  baseUrl: string
  shortcode: string | null
  /** Buy Goods till. Separate from the PayBill short code. PartyB on CustomerBuyGoodsOnline. */
  till: string | null
  passkey: string | null
  consumerKey: string | null
  consumerSecret: string | null
  callbackUrl: string
  accountReference: string
}

function envTrim(name: string): string | null {
  const value = Deno.env.get(name)?.trim()
  return value || null
}

export type DarajaCredProfile = 'primary' | 'alt'

export function darajaConfig(profile: DarajaCredProfile = 'primary'): DarajaConfig {
  const env = Deno.env.toObject()
  const alt = profile === 'alt'
  return {
    ...parseMegapayConfig(env),
    provider: parseDepositProvider(envTrim('DEPOSIT_PROVIDER') ?? env.DEPOSIT_PROVIDER),
    baseUrl: darajaBaseUrl(),
    shortcode: alt ? envTrim('MPESA_ALT_SHORTCODE') : envTrim('MPESA_SHORTCODE'),
    // Alternate paybill profile is Paybill-only; Buy Goods till stays on primary keys.
    till: alt ? null : envTrim('MPESA_TILL'),
    passkey: alt ? envTrim('MPESA_ALT_PASSKEY') : envTrim('MPESA_PASSKEY'),
    consumerKey: alt ? envTrim('MPESA_ALT_CONSUMER_KEY') : envTrim('MPESA_CONSUMER_KEY'),
    consumerSecret: alt ? envTrim('MPESA_ALT_CONSUMER_SECRET') : envTrim('MPESA_CONSUMER_SECRET'),
    callbackUrl: envTrim('MPESA_CALLBACK_URL') || DEFAULT_DARAJA_CALLBACK_URL,
    accountReference: accountReference(envTrim('MPESA_ACCOUNT_REFERENCE')),
  }
}

export async function resolveDarajaConfig(
  admin: SupabaseClient,
  profile: DarajaCredProfile = 'primary',
): Promise<DarajaConfig & { quickAmounts: number[]; payRoute: string }> {
  const map = await loadPaymentSettingsMap(admin)
  const route = String(map.DEPOSIT_PAY_ROUTE ?? '').trim().toLowerCase()
  const resolvedProfile: DarajaCredProfile =
    profile === 'alt' || route === 'paybill_alt' || route === 'paybill2' || route === '4088285' ? 'alt' : 'primary'
  const base = darajaConfig(resolvedProfile)
  const money = mergeMegapayConfig(base, map)
  const deposit = depositFeesFromMap(map, base)
  const provider = parseDepositProvider(map.DEPOSIT_PROVIDER || base.provider)
  return {
    ...base,
    ...money,
    provider,
    quickAmounts: parseQuickAmounts(deposit.quickAmounts),
    payRoute: route || 'till',
  }
}

export function darajaConfigured(cfg: DarajaConfig): boolean {
  return Boolean(cfg.shortcode && cfg.passkey && cfg.consumerKey && cfg.consumerSecret)
}

export class DarajaAuthError extends Error {
  constructor(public httpStatus: number, message: string) {
    super(message)
  }
}

let tokenCache: { token: string; expiresAt: number; key: string } | null = null

export async function getAccessToken(cfg: DarajaConfig, force = false): Promise<string> {
  const key = `${cfg.baseUrl}|${cfg.consumerKey}`
  if (!force && tokenCache && tokenCache.key === key && Date.now() < tokenCache.expiresAt) return tokenCache.token
  let lastError: DarajaAuthError | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${cfg.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
        method: 'GET',
        headers: { Authorization: `Basic ${btoa(`${cfg.consumerKey}:${cfg.consumerSecret}`)}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      })
      const text = await res.text()
      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(text)
      } catch {
        body = {}
      }
      const token = body.access_token
      if (!res.ok || typeof token !== 'string' || !token) {
        tokenCache = null
        const message = String(body.errorMessage ?? body.error_description ?? body.error ?? (text.slice(0, 120) || 'no body'))
        lastError = new DarajaAuthError(res.status, message.slice(0, 200))
        if (res.status >= 500 || res.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 400))
          continue
        }
        throw lastError
      }
      const ttlSeconds = Number(body.expires_in) || 3599
      tokenCache = { token, key, expiresAt: Date.now() + Math.max(60, ttlSeconds - 60) * 1000 }
      return token
    } catch (err) {
      if (err instanceof DarajaAuthError && err.httpStatus < 500 && err.httpStatus !== 429) throw err
      lastError = err instanceof DarajaAuthError ? err : new DarajaAuthError(0, String(err).slice(0, 200))
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }
  throw lastError ?? new DarajaAuthError(0, 'M-Pesa authorization failed')
}

export async function darajaPost(cfg: DarajaConfig, path: string, payload: Record<string, unknown>, timeoutMs: number) {
  const send = async (token: string) =>
    fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
  let res = await send(await getAccessToken(cfg))
  if (res.status === 401) {
    await res.body?.cancel()
    res = await send(await getAccessToken(cfg, true))
  }
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 300) }
  }
  return { httpStatus: res.status, body }
}

export function registeredCallbackUrl(cfg: DarajaConfig): string {
  return cfg.callbackUrl.replace(/\?.*$/, '').trim() || DEFAULT_DARAJA_CALLBACK_URL
}

function stkAccepted(res: { httpStatus: number; body: Record<string, unknown> }): boolean {
  const checkout = res.body.CheckoutRequestID
  return (
    res.httpStatus >= 200 &&
    res.httpStatus < 300 &&
    String(res.body.ResponseCode ?? '') === '0' &&
    typeof checkout === 'string' &&
    Boolean(checkout.trim())
  )
}

function stkRetryable(res: { httpStatus: number; body: Record<string, unknown> }): boolean {
  if (stkAccepted(res)) return false
  const code = String(res.body.ResponseCode ?? res.body.errorCode ?? '')
  const msg = String(res.body.errorMessage ?? res.body.ResponseDescription ?? '')
  return (
    res.httpStatus >= 500 ||
    res.httpStatus === 429 ||
    code === '9999' ||
    code === '1025' ||
    /timeout|try again|busy|occurred while sending push/i.test(msg)
  )
}

export async function stkPush(
  cfg: DarajaConfig,
  amountKes: number,
  msisdn: string,
  copy?: {
    description?: string
    accountReference?: string
    callbackUrl?: string
    transactionType?: DarajaStkType
    partyB?: string
  },
) {
  const payload = () =>
    buildStkPushRequest({
      shortcode: cfg.shortcode!,
      passkey: cfg.passkey!,
      amountKes,
      msisdn,
      callbackUrl: copy?.callbackUrl || registeredCallbackUrl(cfg),
      accountReference: copy?.accountReference ?? cfg.accountReference,
      description: copy?.description ?? DEFAULT_TRANSACTION_DESC,
      transactionType: copy?.transactionType,
      partyB: copy?.partyB,
    })
  let last: { httpStatus: number; body: Record<string, unknown> } | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await darajaPost(cfg, '/mpesa/stkpush/v1/processrequest', payload(), 20_000)
      last = res
      if (stkAccepted(res) || !stkRetryable(res) || attempt === 1) return res
    } catch (err) {
      if (attempt === 1) throw err
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return last ?? { httpStatus: 504, body: { errorMessage: 'M-Pesa request timed out' } }
}

export function stkQuery(cfg: DarajaConfig, checkoutRequestId: string) {
  return darajaPost(cfg, '/mpesa/stkpushquery/v1/query', buildStkQueryRequest(cfg.shortcode!, cfg.passkey!, checkoutRequestId), 20_000)
}

export interface DarajaDepositRow extends DepositRow {
  merchant_request_id: string | null
  checkout_request_id: string | null
  mpesa_receipt: string | null
  result_code: string | null
  result_desc: string | null
  callback_amount_kes: number | string | null
  callback_at: string | null
  last_query_at: string | null
}

export const DARAJA_DEPOSIT_COLUMNS = `${DEPOSIT_COLUMNS}, merchant_request_id, checkout_request_id, mpesa_receipt, result_code, result_desc, callback_amount_kes, callback_at, last_query_at`

export async function loadDarajaDeposit(admin: SupabaseClient, id: string): Promise<DarajaDepositRow | null> {
  const { data } = await admin.from('deposits').select(DARAJA_DEPOSIT_COLUMNS).eq('id', id).maybeSingle()
  return (data as DarajaDepositRow | null) ?? null
}

export async function findByCheckoutRequestId(admin: SupabaseClient, checkoutRequestId: string): Promise<DarajaDepositRow | null> {
  const { data } = await admin
    .from('deposits')
    .select(DARAJA_DEPOSIT_COLUMNS)
    .eq('provider', DARAJA_PROVIDER)
    .eq('checkout_request_id', checkoutRequestId)
    .maybeSingle()
  return (data as DarajaDepositRow | null) ?? null
}

function storedCallback(d: DarajaDepositRow): CallbackEvidence | null {
  if (!d.callback_at && d.result_code == null) return null
  const amount = d.callback_amount_kes == null ? null : Number(d.callback_amount_kes)
  return {
    amountKes: amount != null && Number.isFinite(amount) ? amount : null,
    receipt: d.mpesa_receipt,
    resultCode: d.result_code,
    resultDesc: d.result_desc,
  }
}

export async function reconcileDarajaDeposit(
  admin: SupabaseClient,
  cfg: DarajaConfig,
  deposit: DarajaDepositRow,
  opts: { force?: boolean } = {},
): Promise<DarajaDepositRow> {
  if (deposit.provider !== DARAJA_PROVIDER) return deposit
  const creditable = isOpenStatus(deposit.status) || (deposit.status === 'FAILED' && deposit.details?.failure_kind === 'expired')
  if (!creditable) return deposit
  const now = Date.now()
  const ageMs = now - Date.parse(deposit.created_at)
  const callback = storedCallback(deposit)
  const sinceLastQuery = deposit.last_query_at ? now - Date.parse(deposit.last_query_at) : null

  let query: StkQueryClassification | null = null
  let queryBody: unknown = {}
  if (
    darajaConfigured(cfg) &&
    deposit.checkout_request_id &&
    (opts.force || shouldQueryNow(ageMs, sinceLastQuery, callback != null))
  ) {
    await admin.from('deposits').update({ last_query_at: new Date(now).toISOString() }).eq('id', deposit.id)
    try {
      const res = await stkQuery(cfg, deposit.checkout_request_id)
      queryBody = res.body
      query = classifyStkQuery(res.body, deposit.checkout_request_id)
      if (query.resultCode != null && query.outcome !== 'pending') {
        await admin
          .from('deposits')
          .update({ result_code: query.resultCode, result_desc: query.description.slice(0, 300) })
          .eq('id', deposit.id)
      }
    } catch (err) {
      await logEdgeError(
        admin,
        'deposits',
        'daraja.stk_query',
        err instanceof DarajaAuthError ? `oauth ${err.httpStatus}` : err,
        { code: err instanceof DarajaAuthError ? String(err.httpStatus) : null },
      )
    }
  }

  const decision = decideDarajaSettlement({
    status: deposit.status,
    failureKind: (deposit.details?.failure_kind as string | undefined) ?? null,
    expectedKes: Number(deposit.details?.amount_kes),
    ageMs,
    query,
    callback,
  })

  if (decision.action === 'credit') {
    const serviceCharge = isServiceChargeDepositDetails(deposit.details)
    const { error } = await admin.rpc(serviceCharge ? 'complete_service_charge_deposit' : 'credit_megapay_deposit', {
      p_deposit_id: deposit.id,
      p_receipt: decision.receipt ?? '',
      p_amount_kes: decision.amountKes,
      p_raw: { source: 'daraja_stk_query', query: queryBody, callback_amount_kes: callback?.amountKes ?? null },
    })
    if (error) {
      await logEdgeError(
        admin,
        'deposits',
        serviceCharge ? 'daraja.complete_service_charge' : 'daraja.credit_deposit',
        error,
        { code: error.code },
      )
      const userEmail = await lookupUserEmail(admin, deposit.user_id)
      await notifyAdminsPaymentIssue(admin, {
        issue: 'credit_failed',
        reason: error.message || 'Credit RPC failed after M-Pesa confirmation',
        amountKes: decision.amountKes,
        userEmail,
        depositId: deposit.id,
        reference: String(deposit.details?.reference ?? ''),
        rail: String(deposit.details?.rail ?? 'daraja'),
      })
    } else {
      console.log(serviceCharge ? 'service charge deposit completed' : 'daraja deposit credited', deposit.id)
      const kind = serviceCharge
        ? (serviceKind(deposit.details?.kind) ?? 'service_charge')
        : 'deposit'
      const userEmail = await lookupUserEmail(admin, deposit.user_id)
      await notifyAdminsPaymentReceived(admin, {
        amountKes: decision.amountKes,
        kind,
        userEmail,
        receipt: decision.receipt ?? null,
        depositId: deposit.id,
      })
    }
  } else if (decision.action === 'fail') {
    const { error } = await admin.rpc('fail_megapay_deposit', {
      p_deposit_id: deposit.id,
      p_status: decision.status,
      p_kind: decision.kind,
      p_reason: decision.reason,
      p_raw: queryBody ?? {},
    })
    if (error) await logEdgeError(admin, 'deposits', 'daraja.fail_deposit', error, { code: error.code })
    else {
      console.log('daraja deposit', decision.status.toLowerCase(), deposit.id, decision.kind)
      const userEmail = await lookupUserEmail(admin, deposit.user_id)
      const issue =
        decision.status === 'CANCELLED'
          ? 'cancelled'
          : decision.kind === 'expired'
            ? 'delayed'
            : 'failed'
      await notifyAdminsPaymentIssue(admin, {
        issue,
        reason: decision.reason,
        amountKes: Number(deposit.details?.amount_kes),
        userEmail,
        depositId: deposit.id,
        reference: String(deposit.details?.reference ?? ''),
        resultCode: query?.resultCode ?? callback?.resultCode ?? null,
        rail: String(deposit.details?.rail ?? 'daraja'),
        ageMinutes: ageMs / 60_000,
      })
    }
  } else if (
    isOpenStatus(deposit.status) &&
    ageMs >= DELAY_NOTIFY_MS &&
    !deposit.details?.admin_delay_notified_at
  ) {
    const notifiedAt = new Date(now).toISOString()
    await admin
      .from('deposits')
      .update({ details: { ...deposit.details, admin_delay_notified_at: notifiedAt } })
      .eq('id', deposit.id)
    const userEmail = await lookupUserEmail(admin, deposit.user_id)
    await notifyAdminsPaymentIssue(admin, {
      issue: 'delayed',
      reason: 'Deposit still pending after several minutes with no final M-Pesa result',
      amountKes: Number(deposit.details?.amount_kes),
      userEmail,
      depositId: deposit.id,
      reference: String(deposit.details?.reference ?? ''),
      resultCode: query?.resultCode ?? callback?.resultCode ?? null,
      rail: String(deposit.details?.rail ?? 'daraja'),
      ageMinutes: ageMs / 60_000,
    })
  }

  return (await loadDarajaDeposit(admin, deposit.id)) ?? deposit
}

export async function sweepDarajaDeposits(admin: SupabaseClient, cfg: DarajaConfig, limit = 25) {
  const { data, error } = await admin
    .from('deposits')
    .select(DARAJA_DEPOSIT_COLUMNS)
    .eq('provider', DARAJA_PROVIDER)
    .in('status', ['PENDING', 'PROCESSING'])
    .lt('created_at', new Date(Date.now() - SWEEP_MIN_AGE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)
  const results: Array<{ id: string; status: string }> = []
  for (const row of (data ?? []) as DarajaDepositRow[]) {
    const settled = await reconcileDarajaDeposit(admin, cfg, row)
    results.push({ id: row.id, status: settled.status })
  }
  return results
}
