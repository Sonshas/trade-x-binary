import { safeUserMessage } from "@/lib/safe-user-message";

/** Shown only when M-Pesa did not return a reason the member can act on. */
export const MPESA_PROMPT_SUPPORT =
  "Payment prompt failed. Contact support for assistance.";

/**
 * Member copy for a failed or cancelled STK prompt.
 * Phone-side Safaricom results stay specific. Unknown or system failures keep the support line.
 */
export function mpesaPromptFailureMessage(reason: string | null | undefined): string {
  const text = typeof reason === "string" ? reason.replace(/\s+/g, " ").trim() : "";
  if (!text) return MPESA_PROMPT_SUPPORT;
  const lower = text.toLowerCase();
  if (lower.includes("cancel")) {
    return "The M-Pesa prompt was cancelled. You can try again.";
  }
  if (
    lower.includes("timeout") ||
    lower.includes("unreachable") ||
    lower.includes("cannot be reached") ||
    lower.includes("no response") ||
    lower.includes("did not complete")
  ) {
    return "The phone did not answer the M-Pesa prompt. Keep the phone on, confirm the Safaricom number, and try again.";
  }
  if (
    lower.includes("1025") ||
    lower.includes("9999") ||
    lower.includes("sending push") ||
    lower.includes("stk send failed")
  ) {
    return "M-Pesa did not show the prompt. Wait about a minute, keep the phone on, then try once more.";
  }
  if (lower.includes("insufficient")) {
    return "M-Pesa reported not enough balance for this amount. Try a smaller amount.";
  }
  if (lower.includes("unresolved") || lower.includes("temporarily unavailable")) {
    return MPESA_PROMPT_SUPPORT;
  }
  return safeUserMessage(text, MPESA_PROMPT_SUPPORT);
}
