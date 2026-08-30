// OTP timing for the password-change flow. Shared so both clients expire codes and
// gate the resend button on the same schedule.

/** Seconds a freshly sent code stays valid. */
export const OTP_EXPIRY_SECONDS = 120

/** Seconds before the resend button becomes available again. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60

/** m:ss, as the countdown is shown. */
export function formatOtpCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0))
  const mins = Math.floor(safe / 60)
  const secs = safe % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
