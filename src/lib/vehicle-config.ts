export type VehicleTypeValue = 'TRUCK' | 'TRICYCLE' | string
export type VehicleClassificationValue = 'LIGHT_DUTY' | 'MEDIUM_DUTY' | 'HEAVY_DUTY' | string
export type VehicleStatusValue = 'AVAILABLE' | 'IN_USE' | 'MAINTENANCE' | 'OUT_OF_SERVICE' | string

export interface ClassificationOption {
  value: VehicleClassificationValue
  label: string
  capacityKg: number
}

export interface VehicleTypeOption {
  value: VehicleTypeValue
  label: string
  classifications: ClassificationOption[]
}

export const VEHICLE_CAPACITY_RULES: Record<string, VehicleTypeOption> = {
  TRUCK: {
    value: 'TRUCK',
    label: 'Truck',
    classifications: [
      { value: 'LIGHT_DUTY', label: 'Light-Duty', capacityKg: 2500 },
      { value: 'MEDIUM_DUTY', label: 'Medium-Duty', capacityKg: 5000 },
      { value: 'HEAVY_DUTY', label: 'Heavy-Duty', capacityKg: 10000 },
    ],
  },
  TRICYCLE: {
    value: 'TRICYCLE',
    label: 'Tricycle',
    classifications: [
      { value: 'LIGHT_DUTY', label: 'Light-Duty', capacityKg: 500 },
    ],
  },
}

export const VEHICLE_STATUS_OPTIONS = [
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'IN_USE', label: 'In Use' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'OUT_OF_SERVICE', label: 'Out of Service' },
]

export function getVehicleTypes(): Array<{ value: string; label: string }> {
  return Object.values(VEHICLE_CAPACITY_RULES).map((entry) => ({
    value: entry.value,
    label: entry.label,
  }))
}

export function getClassificationsForType(type: string): ClassificationOption[] {
  const normalizedType = String(type || '').trim().toUpperCase()
  return VEHICLE_CAPACITY_RULES[normalizedType]?.classifications || []
}

export function getPredefinedCapacity(type: string, classification: string): number {
  const normalizedType = String(type || '').trim().toUpperCase()
  const normalizedClassification = String(classification || '').trim().toUpperCase()
  const typeConfig = VEHICLE_CAPACITY_RULES[normalizedType]
  if (!typeConfig) return 0
  const match = typeConfig.classifications.find(
    (item) => item.value === normalizedClassification
  )
  return match?.capacityKg ?? (typeConfig.classifications[0]?.capacityKg || 0)
}

export function getDefaultClassificationForType(type: string): string {
  const normalizedType = String(type || '').trim().toUpperCase()
  return VEHICLE_CAPACITY_RULES[normalizedType]?.classifications[0]?.value || 'LIGHT_DUTY'
}

export function isClassificationValidForType(type: string, classification: string): boolean {
  const normalizedType = String(type || '').trim().toUpperCase()
  const normalizedClassification = String(classification || '').trim().toUpperCase()
  const classifications = getClassificationsForType(normalizedType)
  return classifications.some((item) => item.value === normalizedClassification)
}

export function formatCapacity(capacityKg: number | string | null | undefined): string {
  const value = Number(capacityKg)
  if (!Number.isFinite(value) || value <= 0) return '0 kg'
  return `${value.toLocaleString()} kg`
}

export function formatVehicleType(type: string | null | undefined): string {
  const normalized = String(type || '').trim().toUpperCase()
  return VEHICLE_CAPACITY_RULES[normalized]?.label || String(type || 'Vehicle')
}

export function formatVehicleClassification(classification: string | null | undefined): string {
  const normalized = String(classification || '').trim().toUpperCase()
  switch (normalized) {
    case 'LIGHT_DUTY':
      return 'Light-Duty'
    case 'MEDIUM_DUTY':
      return 'Medium-Duty'
    case 'HEAVY_DUTY':
      return 'Heavy-Duty'
    default:
      return String(classification || 'Light-Duty').replace(/_/g, ' ')
  }
}

export function formatVehicleStatus(status: string | null | undefined): string {
  const normalized = String(status || '').trim().toUpperCase()
  const found = VEHICLE_STATUS_OPTIONS.find((s) => s.value === normalized)
  return found?.label || normalized.replace(/_/g, ' ')
}

export function validateDeliveryCapacity(
  shipmentWeightKg: number,
  vehicleCapacityKg: number
): { valid: boolean; error?: string } {
  const weight = Math.max(0, Number(shipmentWeightKg) || 0)
  const capacity = Math.max(0, Number(vehicleCapacityKg) || 0)

  if (capacity > 0 && weight > capacity) {
    return {
      valid: false,
      error: `Vehicle capacity exceeded. This shipment weighs ${weight.toLocaleString()} kg, while the selected vehicle can only carry ${capacity.toLocaleString()} kg.`,
    }
  }

  return { valid: true }
}

export function isVehicleAssignable(vehicle: any): boolean {
  if (!vehicle) return false
  const isActive = vehicle.isActive !== false && vehicle.is_active !== false
  const status = String(vehicle.status || '').trim().toUpperCase()
  return isActive && status === 'AVAILABLE'
}
