export const BEVERAGE_CATEGORY_SPECS = {
  'Carbonated (Glass)': {
    packagingType: 'Glass Bottle',
    looseUnit: 'Glass Bottle',
    compatibilityKey: 'GLASS_BOTTLE',
    depositAllowed: true,
    depositExempt: false,
  },
  'Carbonated (PET/PLASTIC)': {
    packagingType: 'PET/Plastic Bottle',
    looseUnit: 'PET/Plastic Bottle',
    compatibilityKey: 'PET_PLASTIC_BOTTLE',
    depositAllowed: false,
    depositExempt: false,
  },
  'Carbonated (Cans)': {
    packagingType: 'Can',
    looseUnit: 'Can',
    compatibilityKey: 'CAN',
    depositAllowed: false,
    depositExempt: false,
  },
  'Energy Drinks (Glass)': {
    packagingType: 'Glass Bottle',
    looseUnit: 'Glass Bottle',
    compatibilityKey: 'GLASS_BOTTLE',
    depositAllowed: true,
    depositExempt: false,
  },
  'Energy Drinks': {
    packagingType: 'PET/Plastic Bottle',
    looseUnit: 'PET/Plastic Bottle',
    compatibilityKey: 'PET_PLASTIC_BOTTLE',
    depositAllowed: false,
    depositExempt: false,
  },
  'Sport Drinks': {
    packagingType: 'PET/Plastic Bottle',
    looseUnit: 'PET/Plastic Bottle',
    compatibilityKey: 'PET_PLASTIC_BOTTLE',
    depositAllowed: false,
    depositExempt: false,
  },
  Alcohol: {
    packagingType: 'Glass Bottle',
    looseUnit: 'Glass Bottle',
    compatibilityKey: 'GLASS_BOTTLE',
    depositAllowed: false,
    depositExempt: true,
  },
} as const

export type BeverageCategory = keyof typeof BEVERAGE_CATEGORY_SPECS

const CATEGORY_ALIASES: Record<string, BeverageCategory> = {
  'carbonated(glass)': 'Carbonated (Glass)',
  'carbonated(pet/plastic)': 'Carbonated (PET/PLASTIC)',
  'carbonated(cans)': 'Carbonated (Cans)',
  'energy drinks(glass)': 'Energy Drinks (Glass)',
}

export const BEVERAGE_CATEGORIES = Object.keys(BEVERAGE_CATEGORY_SPECS) as BeverageCategory[]

export function getBeverageCategorySpec(value: unknown) {
  const raw = String(value || '').trim()
  const category = BEVERAGE_CATEGORIES.find((candidate) => candidate.toLowerCase() === raw.toLowerCase())
    || CATEGORY_ALIASES[raw.toLowerCase()]
  return category ? { category, ...BEVERAGE_CATEGORY_SPECS[category] } : null
}

export function formatLooseQuantity(quantity: number, looseUnit: string) {
  const label = quantity === 1 ? looseUnit : looseUnit === 'Can' ? 'Cans' : `${looseUnit}s`
  return `${quantity} ${label}`
}

export function getLooseUnitFromRecord(record: any): string {
  const product = record?.product || record || {}
  return String(
    record?.containerTypeName ||
    record?.looseUnit ||
    product?.containerTypeName ||
    product?.looseUnit ||
    getBeverageCategorySpec(record?.productCategory || product?.category)?.looseUnit ||
    ''
  ).trim() || 'Container'
}
