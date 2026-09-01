// OTP timing for the change-password flow.
//
// These mirror shared/customer-logic/src/otp.ts, which the web portal and the customer
// app import directly. The driver app keeps its own copy because importing across the
// workspace root needs Metro's watchFolders, and a config change only takes effect on a
// full dev-server restart — so a stale server serves a bundle that fails to resolve and
// the app renders as a blank white page.
//
// otp.test.ts asserts this copy still equals the shared source, so the three clients
// cannot drift on when a code expires.

/** Seconds a freshly sent code stays valid. */
export const OTP_EXPIRY_SECONDS = 120;

/** Seconds before the resend button becomes available again. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** m:ss, as the countdown is shown. */
export function formatOtpCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
