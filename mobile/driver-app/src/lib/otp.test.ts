import assert from "node:assert/strict";
import test from "node:test";

import {
  OTP_EXPIRY_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
  formatOtpCountdown,
} from "./otp.ts";
import * as sharedOtp from "../../../../shared/customer-logic/src/otp.ts";

// The driver app cannot import the shared module through Metro without watchFolders,
// so it keeps a copy. This is the guard that stops the copy drifting: the web portal
// and the customer app read the shared file directly, and all three have to agree on
// when a code dies and when the resend unlocks.
test("the driver app's OTP timings match the shared source", () => {
  assert.equal(OTP_EXPIRY_SECONDS, sharedOtp.OTP_EXPIRY_SECONDS);
  assert.equal(OTP_RESEND_COOLDOWN_SECONDS, sharedOtp.OTP_RESEND_COOLDOWN_SECONDS);
});

test("the countdown formats identically to the shared source", () => {
  for (const seconds of [0, 1, 9, 10, 59, 60, 61, 114, 120, -5, Number.NaN]) {
    assert.equal(formatOtpCountdown(seconds), sharedOtp.formatOtpCountdown(seconds), String(seconds));
  }
});

test("the countdown reads as m:ss", () => {
  assert.equal(formatOtpCountdown(114), "1:54");
  assert.equal(formatOtpCountdown(60), "1:00");
  assert.equal(formatOtpCountdown(9), "0:09");
  assert.equal(formatOtpCountdown(0), "0:00");
});
