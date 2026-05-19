export function isValidPhilippinePhone(phone: string): boolean {
  const cleaned = String(phone || "").replace(/\D/g, "")
  return /^09\d{9}$/.test(cleaned) || /^63\d{10}$/.test(cleaned)
}

export function formatPhilippinePhoneInput(value: string): string {
  let cleaned = String(value || "").replace(/\D/g, "")
  if (cleaned.length > 12) cleaned = cleaned.slice(0, 12)
  if (cleaned.length >= 2 && !cleaned.startsWith("09") && !cleaned.startsWith("63")) {
    cleaned = "09" + cleaned.slice(0, 9)
  }
  return cleaned
}
