import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { DARAJA_PROVIDER } from "../_shared/daraja.ts";
import {
  generateDepositReference,
  kesToUsd,
  maskPhone,
  normalizeKenyanPhone,
  validateAmountKes,
} from "../_shared/megapay.ts";
import { realAccountShort } from "../_shared/branding.ts";
import {
  UNAVAILABLE_MESSAGE,
  adminClient,
  corsHeaders,
  json,
  logEdgeError,
  loadPaymentSettingsMap,
  publicDeposit,
  realPaymentsEnabled,
  userFromRequest,
} from "../_shared/server.ts";
import { loadUserAccess } from "../_shared/user-access.ts";
import { type DepositPayRoute } from "../_shared/payments/deposit-rail.ts";
import {
  DARAJA_DEPOSIT_COLUMNS,
  DarajaAuthError,
  darajaConfigured,
  registeredCallbackUrl,
  resolveDarajaConfig,
  stkPush,
  type DarajaDepositRow,
} from "../_shared/daraja-server.ts";

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_PENDING = 1;

/** Live lock — Winsoft Daraja Paybill 4088285 only. */
const LOCKED_ROUTE: DepositPayRoute = "paybill_alt";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();
  const user = await userFromRequest(admin, req);
  if (!user) return json({ error: "Sign in to deposit." }, 401);

  // Keep payment_settings aligned, but never honor till / primary / megapay here.
  void (await loadPaymentSettingsMap(admin));
  const route = LOCKED_ROUTE;
  const cfg = await resolveDarajaConfig(admin, "alt");
  const enabled = await realPaymentsEnabled(admin);
  const configured = darajaConfigured(cfg);
  const displayPaybill = cfg.shortcode;

  if (req.method === "GET") {
    return json({
      provider: DARAJA_PROVIDER,
      enabled: enabled && configured,
      pay_route: route,
      method: "mpesa",
      currency: "USD",
      paybill: displayPaybill,
      kes_per_usd: cfg.kesPerUsd,
      min_kes: cfg.minKes,
      max_kes: cfg.maxKes,
      quick_amounts: cfg.quickAmounts,
      message: enabled && configured
        ? null
        : !darajaConfigured(cfg)
          ? "Paybill 4088285 is not configured yet."
          : UNAVAILABLE_MESSAGE,
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!configured) {
    return json(
      { error: "Paybill 4088285 is not configured on the server (MPESA_ALT_*)." },
      503,
    );
  }
  if (!enabled)
    return json(
      { error: `${realAccountShort()} deposits are not enabled yet.` },
      403,
    );

  const access = await loadUserAccess(admin, user.id);
  if (!access || access.accountStatus === "suspended") {
    return json({ error: "This account cannot deposit right now." }, 403);
  }
  if (!access.depositsEnabled) {
    return json(
      { error: "Deposits are turned off for this account. Contact support." },
      403,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const amount = validateAmountKes(body.amount_kes, cfg);
  if (!amount.ok) return json({ error: amount.error }, 400);
  const msisdn = normalizeKenyanPhone(String(body.phone ?? ""));
  if (!msisdn)
    return json(
      { error: "Enter a valid Safaricom M-Pesa number, e.g. 0712345678." },
      400,
    );

  const { data: wallet, error: walletError } = await admin
    .from("wallets")
    .select("id, account_id, currency, is_simulated")
    .eq("user_id", user.id)
    .eq("account_mode", "real")
    .eq("is_simulated", false)
    .maybeSingle();
  if (walletError || !wallet) {
    return json(
      {
        error: `Your ${realAccountShort()} wallet is not ready yet. Please contact support.`,
      },
      409,
    );
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { data: pendingRows } = await admin
    .from("deposits")
    .select("id, details")
    .eq("user_id", user.id)
    .eq("provider", DARAJA_PROVIDER)
    .eq("status", "PENDING")
    .gte("created_at", since);
  const pendingWallet = (pendingRows ?? []).filter((row) => {
    const details = (row as { details?: Record<string, unknown> }).details;
    return (
      details?.type !== "service_charge" &&
      details?.kind !== "scanner" &&
      details?.kind !== "verification" &&
      details?.kind !== "tax"
    );
  }).length;
  if (pendingWallet >= RATE_LIMIT_MAX_PENDING) {
    return json(
      {
        error:
          "You have several deposits waiting for M-Pesa. Please wait a few minutes and try again.",
      },
      429,
    );
  }

  const amountUsd = kesToUsd(amount.amountKes, cfg.kesPerUsd);
  if (amountUsd <= 0) return json({ error: "Amount is too small." }, 400);

  const rail = "daraja_alt";
  const transactionType = "CustomerPayBillOnline" as const;
  const partyB = cfg.shortcode!;
  const useTill = false;

  let deposit: DarajaDepositRow | null = null;
  let reference = "";
  for (let attempt = 0; attempt < 3 && !deposit; attempt++) {
    reference = generateDepositReference();
    const { data, error } = await admin
      .from("deposits")
      .insert({
        user_id: user.id,
        account_id: wallet.account_id,
        account_mode: "real",
        wallet_id: wallet.id,
        amount: amountUsd,
        currency: wallet.currency || "USD",
        method: "mpesa",
        status: "PENDING",
        provider: DARAJA_PROVIDER,
        is_simulated: false,
        details: {
          reference,
          amount_kes: amount.amountKes,
          rate: cfg.kesPerUsd,
          phone_masked: maskPhone(msisdn),
          paybill: useTill ? null : cfg.shortcode,
          till: useTill ? cfg.till : null,
          rail,
          pay_route: route,
          account_reference: cfg.accountReference,
          initiated_at: new Date().toISOString(),
        },
      })
      .select(DARAJA_DEPOSIT_COLUMNS)
      .single();
    if (data) deposit = data as DarajaDepositRow;
    else if (error?.code !== "23505") {
      await logEdgeError(admin, "deposits", "mpesa-deposit.insert", error, {
        code: error?.code,
        userId: user.id,
      });
      return json({ error: UNAVAILABLE_MESSAGE }, 500);
    }
  }
  if (!deposit || !reference) return json({ error: UNAVAILABLE_MESSAGE }, 500);

  let ids: { merchant: string | null; checkout: string } | null = null;
  let failure: { kind: string; reason: string; raw: unknown } | null = null;
  try {
    const res = await stkPush(cfg, amount.amountKes, msisdn, {
        accountReference: cfg.accountReference,
        callbackUrl: registeredCallbackUrl(cfg),
        description: "Deposit",
        transactionType,
        partyB,
      });
    const checkout = res.body.CheckoutRequestID;
    if (
      res.httpStatus >= 200 &&
      res.httpStatus < 300 &&
      String(res.body.ResponseCode ?? "") === "0" &&
      typeof checkout === "string" &&
      checkout.trim()
    ) {
      ids = {
        merchant:
          typeof res.body.MerchantRequestID === "string"
            ? res.body.MerchantRequestID
            : null,
        checkout: checkout.trim(),
      };
    } else {
      failure = {
        kind: "initiation_failed",
        reason: String(
          res.body.errorMessage ??
            res.body.ResponseDescription ??
            "STK push rejected",
        ).slice(0, 200),
        raw: {
          http_status: res.httpStatus,
          errorCode: res.body.errorCode ?? null,
          ResponseCode: res.body.ResponseCode ?? null,
          rail,
        },
      };
    }
  } catch (err) {
    failure =
      err instanceof DarajaAuthError
        ? {
            kind: "initiation_failed",
            reason: "M-Pesa authorization failed",
            raw: { oauth_status: err.httpStatus, rail },
          }
        : {
            kind: "initiation_failed",
            reason: "M-Pesa request timed out",
            raw: { error: String(err).slice(0, 200), rail },
          };
  }

  if (!ids) {
    await logEdgeError(
      admin,
      "deposits",
      "mpesa-deposit.stk_push",
      failure?.reason ?? "STK push rejected",
      {
        userId: user.id,
        code: failure?.kind ?? null,
      },
    );
    // A timed-out push may still reach the phone. Leave it open so the callback can credit it.
    if (failure?.reason === "M-Pesa request timed out") {
      return json({
        ...publicDeposit(deposit),
        status: "PENDING",
        pay_route: route,
        message: "Check your phone. M-Pesa is slow to send the prompt.",
      });
    }
    await admin.rpc("fail_megapay_deposit", {
      p_deposit_id: deposit.id,
      p_status: "FAILED",
      p_kind: failure?.kind ?? "initiation_failed",
      p_reason: failure?.reason ?? "STK push rejected",
      p_raw: failure?.raw ?? {},
    });
    return json(
      {
        error: "STK send failed, contact support for assistance",
        deposit_id: deposit.id,
        status: "FAILED",
      },
      502,
    );
  }

  const { error: updateError } = await admin
    .from("deposits")
    .update({
      provider_reference: ids.checkout,
      checkout_request_id: ids.checkout,
      merchant_request_id: ids.merchant,
      details: {
        ...deposit.details,
        rail,
        pay_route: route,
        checkout_request_id: ids.checkout,
        merchant_request_id: ids.merchant,
      },
    })
    .eq("id", deposit.id);
  if (updateError) {
    await logEdgeError(
      admin,
      "deposits",
      "mpesa-deposit.store_checkout",
      updateError,
      {
        code: updateError.code,
        userId: user.id,
      },
    );
  }
  console.log("stk push sent", rail, deposit.id, maskPhone(msisdn), amount.amountKes);

  return json({
    ...publicDeposit(deposit),
    status: "PENDING",
    pay_route: route,
    message: "STK sent successfully",
  });
});
