export function isValidPhilippinePhone(phone: string): boolean {
  const cleaned = String(phone || "").replace(/\D/g, "")
  return /^09\d{9}$/.test(cleaned) || /^63\d{10}$/.test(cleaned)
}

export function formatPhilippinePhoneInput(value: string): string {
  const cleaned = String(value || "").replace(/\D/g, "")
  return cleaned.slice(0, 12)
}
