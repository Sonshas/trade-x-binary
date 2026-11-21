import { logEdgeError, recordSystemIssue } from './server.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

/** Always notified for payment failures / delays, even if ADMIN_EMAILS is empty. */
const PAYMENT_ALERT_EMAIL = 'sonshasopunga@gmail.com'

function parseEmails(raw: string | undefined): string[] {
  if (!raw) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[,;\s]+/)) {
    const email = part.trim().toLowerCase()
    if (!email.includes('@') || seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

function adminRecipients(): string[] {
  return parseEmails(Deno.env.get('ADMIN_EMAILS') ?? Deno.env.get('VITE_ADMIN_EMAILS') ?? '')
}

/** Admins plus the fixed payment-alert inbox. */
function paymentAlertRecipients(): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const email of [...adminRecipients(), PAYMENT_ALERT_EMAIL]) {
    const key = email.trim().toLowerCase()
    if (!key.includes('@') || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function formatKes(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '0'
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

export type AdminPaymentKind = 'deposit' | 'verification' | 'scanner' | 'tax' | 'service_charge'

export type PaymentIssueKind = 'failed' | 'cancelled' | 'delayed' | 'initiation_failed' | 'credit_failed' | 'config'

function kindLabel(kind: AdminPaymentKind): string {
  if (kind === 'deposit') return 'deposit'
  if (kind === 'verification') return 'account verification'
  if (kind === 'scanner') return 'AI scanner'
  if (kind === 'tax') return 'tax compliance'
  return 'payment'
}

function issueSubject(kind: PaymentIssueKind, amountKes?: number): string {
  const kes = amountKes != null && Number.isFinite(amountKes) && amountKes > 0 ? ` (KES ${formatKes(amountKes)})` : ''
  if (kind === 'failed') return `Payment failed${kes}`
  if (kind === 'cancelled') return `Payment cancelled${kes}`
  if (kind === 'delayed') return `Payment delayed${kes}`
  if (kind === 'initiation_failed') return `M-Pesa prompt failed${kes}`
  if (kind === 'credit_failed') return `Payment credit failed${kes}`
  return `Payment issue${kes}`
}

async function sendAdminEmail(
  admin: SupabaseClient,
  input: {
    to: string[]
    subject: string
    text: string
    operation: string
    area?: string
  },
): Promise<boolean> {
  if (input.to.length === 0) {
    console.log(input.operation, 'skipped: no recipients')
    return false
  }
  const apiKey = Deno.env.get('RESEND_API_KEY')?.trim()
  if (!apiKey) {
    console.log(input.operation, 'skipped: RESEND_API_KEY not set')
    return false
  }
  const from =
    Deno.env.get('RESEND_FROM')?.trim() ||
    Deno.env.get('ADMIN_PAYMENT_EMAIL_FROM')?.trim() ||
    'Payments <onboarding@resend.dev>'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      await logEdgeError(
        admin,
        input.area ?? 'deposits',
        input.operation,
        `Resend HTTP ${res.status}: ${body.slice(0, 300)}`,
        { code: String(res.status) },
      )
      return false
    }
    console.log(input.operation, 'sent', input.to.length)
    return true
  } catch (err) {
    await logEdgeError(admin, input.area ?? 'deposits', input.operation, err)
    return false
  }
}

/**
 * Email every allow-listed admin when a deposit or service payment clears.
 * Uses Resend when RESEND_API_KEY is set. Never throws — credit path must stay successful.
 */
export async function notifyAdminsPaymentReceived(
  admin: SupabaseClient,
  input: {
    amountKes: number
    kind?: AdminPaymentKind
    userEmail?: string | null
    receipt?: string | null
    depositId?: string | null
  },
): Promise<void> {
  const amountKes = Number(input.amountKes)
  if (!Number.isFinite(amountKes) || amountKes <= 0) return

  const recipients = paymentAlertRecipients()
  const kes = formatKes(amountKes)
  const kind = input.kind ?? 'deposit'
  const label = kindLabel(kind)
  const lines = [
    `You have received KES ${kes}.`,
    '',
    `Type: ${label}`,
  ]
  if (input.userEmail) lines.push(`From member: ${input.userEmail}`)
  if (input.receipt) lines.push(`M-Pesa receipt: ${input.receipt}`)
  if (input.depositId) lines.push(`Reference: ${input.depositId}`)

  await sendAdminEmail(admin, {
    to: recipients,
    subject: `You have received KES ${kes}`,
    text: lines.join('\n'),
    operation: 'admin_payment_email.send',
  })
}

/**
 * Email on payment failure, cancel, delayed pending, or initiation/config problems.
 * Always includes sonshasopunga@gmail.com. Never throws.
 */
export async function notifyAdminsPaymentIssue(
  admin: SupabaseClient,
  input: {
    issue: PaymentIssueKind
    reason: string
    amountKes?: number | null
    userEmail?: string | null
    depositId?: string | null
    reference?: string | null
    resultCode?: string | null
    rail?: string | null
    ageMinutes?: number | null
  },
): Promise<void> {
  const reason = String(input.reason ?? '').trim() || 'Unknown payment issue'
  const amountKes = input.amountKes == null ? null : Number(input.amountKes)
  const recipients = paymentAlertRecipients()
  const lines = [
    `Payment alert: ${input.issue.replace(/_/g, ' ')}.`,
    '',
    `Reason: ${reason}`,
  ]
  if (amountKes != null && Number.isFinite(amountKes) && amountKes > 0) {
    lines.push(`Amount: KES ${formatKes(amountKes)}`)
  }
  if (input.userEmail) lines.push(`Member: ${input.userEmail}`)
  if (input.depositId) lines.push(`Deposit id: ${input.depositId}`)
  if (input.reference) lines.push(`Reference: ${input.reference}`)
  if (input.rail) lines.push(`Rail: ${input.rail}`)
  if (input.resultCode) lines.push(`M-Pesa result code: ${input.resultCode}`)
  if (input.ageMinutes != null && Number.isFinite(input.ageMinutes)) {
    lines.push(`Age: ${Math.round(input.ageMinutes)} minutes`)
  }
  lines.push('', 'Check Admin → Daily deposits / STK queue.')

  await recordSystemIssue(admin, {
    source: 'edge',
    area: 'deposits',
    operation: `payment_issue.${input.issue}`,
    code: input.resultCode ?? input.issue,
    message: lines.filter(Boolean).join(' | ').slice(0, 500),
  })

  await sendAdminEmail(admin, {
    to: recipients,
    subject: issueSubject(input.issue, amountKes ?? undefined),
    text: lines.join('\n'),
    operation: 'admin_payment_issue_email.send',
  })
}

/** Tells the member a withdrawal was failed and the hold was refunded. Never throws. */
export async function notifyWithdrawalFailed(
  admin: SupabaseClient,
  withdrawalId: string,
  _result: unknown,
): Promise<void> {
  try {
    const { data } = await admin
      .from('withdrawals')
      .select('user_id, amount, failure_reason, reference')
      .eq('id', withdrawalId)
      .maybeSingle()
    const row = data as { user_id?: string; amount?: number | string; failure_reason?: string | null; reference?: string | null } | null
    const email = await lookupUserEmail(admin, row?.user_id)
    if (!email) {
      console.log('withdrawal failed email skipped: no user email')
      return
    }
    const reason = (row?.failure_reason ?? '').trim()
    const amount = Number(row?.amount)
    const amountLine = Number.isFinite(amount) ? `$${amount.toFixed(2)}` : 'the requested amount'
    const text = [
      `Your withdrawal of ${amountLine} was not sent.`,
      reason ? `Reason: ${reason}` : '',
      'The hold has been returned to your balance.',
      row?.reference ? `Reference: ${row.reference}` : '',
    ].filter(Boolean).join('\n')
    await sendAdminEmail(admin, {
      to: [email],
      subject: 'Your withdrawal was not sent',
      text,
      operation: 'withdrawal_failed_email',
      area: 'withdrawals',
    })
  } catch (err) {
    await logEdgeError(admin, 'withdrawals', 'withdrawal_failed_email', err)
  }
}

export async function lookupUserEmail(
  admin: SupabaseClient,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null
  const { data } = await admin.from('users').select('email').eq('id', userId).maybeSingle()
  const email = (data as { email?: string | null } | null)?.email
  return typeof email === 'string' && email.includes('@') ? email : null
}
