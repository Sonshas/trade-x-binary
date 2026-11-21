import { describe, expect, it } from "vitest";
import { mpesaPromptFailureMessage } from "@/lib/mpesa-prompt-message";

describe("mpesaPromptFailureMessage", () => {
  it("explains a handset timeout instead of sending the member to support", () => {
    expect(
      mpesaPromptFailureMessage("DS timeout user cannot be reached."),
    ).toMatch(/did not answer/i);
  });

  it("explains a cancelled prompt", () => {
    expect(mpesaPromptFailureMessage("Request Cancelled by user.")).toMatch(
      /cancelled/i,
    );
  });

  it("asks the member to retry when Safaricom accepted STK but the phone prompt never appeared", () => {
    expect(
      mpesaPromptFailureMessage("Error Occurred while sending push request."),
    ).toMatch(/did not show the prompt/i);
    expect(mpesaPromptFailureMessage("STK send failed, contact support for assistance")).toMatch(
      /did not show the prompt/i,
    );
  });

  it("keeps the support line when M-Pesa gave no usable reason", () => {
    expect(mpesaPromptFailureMessage("")).toMatch(/contact support/i);
    expect(mpesaPromptFailureMessage(null)).toMatch(/contact support/i);
    expect(
      mpesaPromptFailureMessage("Failed due to an unresolved reason type."),
    ).toMatch(/contact support/i);
  });
});
