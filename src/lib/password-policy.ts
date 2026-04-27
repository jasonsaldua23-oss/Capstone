export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include uppercase, lowercase, number, and special character, with no spaces.'

export function validatePasswordPolicy(password: string): string | null {
  if (password.length < 8) return PASSWORD_POLICY_MESSAGE
  if (/\s/.test(password)) return PASSWORD_POLICY_MESSAGE
  if (!/[A-Z]/.test(password)) return PASSWORD_POLICY_MESSAGE
  if (!/[a-z]/.test(password)) return PASSWORD_POLICY_MESSAGE
  if (!/\d/.test(password)) return PASSWORD_POLICY_MESSAGE
  if (!/[^A-Za-z0-9]/.test(password)) return PASSWORD_POLICY_MESSAGE
  return null
}
