// Password policy. One rule set drives both the live checklist and the validator,
// so the list a customer is shown cannot disagree with what is enforced.

export type PasswordRequirement = {
  label: string
  met: (password: string) => boolean
}

export const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  { label: 'Min 8 characters', met: (p) => p.length >= 8 },
  { label: 'Uppercase letter', met: (p) => /[A-Z]/.test(p) },
  { label: 'Lowercase letter', met: (p) => /[a-z]/.test(p) },
  { label: 'One number', met: (p) => /\d/.test(p) },
  { label: 'Special character', met: (p) => /[^A-Za-z0-9\s]/.test(p) },
  { label: 'No spaces', met: (p) => p.length > 0 && !/\s/.test(p) },
]

export function getPasswordRequirementState(password: string) {
  return PASSWORD_REQUIREMENTS.map((rule) => ({ label: rule.label, met: rule.met(password) }))
}

export function isPasswordValid(password: string): boolean {
  return PASSWORD_REQUIREMENTS.every((rule) => rule.met(password))
}

export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 8 characters and include uppercase, lowercase, number, and special character, with no spaces.'
