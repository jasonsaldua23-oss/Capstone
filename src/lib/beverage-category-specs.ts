export const BEVERAGE_CATEGORY_SPECS = {
  'Carbonated (Glass)': {
    packagingType: 'Glass Bottle',
    looseUnit: 'Glass Bottle',
    compatibilityKey: 'GLASS_BOTTLE',
    depositAllowed: true,
    depositExempt: false,
  },
  'Carbonated (PET/PLASTIC)': {
    packagingType: 'Plastic Bottle',
    looseUnit: 'Plastic Bottle',
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
    packagingType: 'Plastic Bottle',
    looseUnit: 'Plastic Bottle',
    compatibilityKey: 'PET_PLASTIC_BOTTLE',
    depositAllowed: false,
    depositExempt: false,
  },
  'Sport Drinks': {
    packagingType: 'Plastic Bottle',
    looseUnit: 'Plastic Bottle',
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
  Water: {
    packagingType: 'Plastic Bottle',
    looseUnit: 'Plastic Bottle',
    compatibilityKey: 'PET_PLASTIC_BOTTLE',
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
  'beer & liquor': 'Alcohol',
  'beer and liquor': 'Alcohol',
  beer: 'Alcohol',
  beers: 'Alcohol',
  liquor: 'Alcohol',
  wine: 'Alcohol',
  spirits: 'Alcohol',
  juices: 'Water',
  juice: 'Water',
  'fruit juice': 'Water',
  'soft drinks': 'Carbonated (PET/PLASTIC)',
  'soft drink': 'Carbonated (PET/PLASTIC)',
  soda: 'Carbonated (PET/PLASTIC)',
  carbonated: 'Carbonated (PET/PLASTIC)',
  'energy drink': 'Energy Drinks',
  'sport drink': 'Sport Drinks',
  'sports drink': 'Sport Drinks',
  'sports drinks': 'Sport Drinks',
  water: 'Water',
  'mineral water': 'Water',
  'purified water': 'Water',
}

export const BEVERAGE_CATEGORIES = Object.keys(BEVERAGE_CATEGORY_SPECS) as BeverageCategory[]

export function getBeverageCategorySpec(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return { category: 'Carbonated (PET/PLASTIC)', ...BEVERAGE_CATEGORY_SPECS['Carbonated (PET/PLASTIC)'] }
  const low = raw.toLowerCase()
  const category =
    BEVERAGE_CATEGORIES.find((candidate) => candidate.toLowerCase() === low) ||
    CATEGORY_ALIASES[low]
  if (category) return { category, ...BEVERAGE_CATEGORY_SPECS[category] }

  // Fuzzy match fallback
  if (low.includes('glass')) return { category: low.includes('energy') ? 'Energy Drinks (Glass)' : 'Carbonated (Glass)', ...BEVERAGE_CATEGORY_SPECS[low.includes('energy') ? 'Energy Drinks (Glass)' : 'Carbonated (Glass)'] }
  if (low.includes('can')) return { category: 'Carbonated (Cans)', ...BEVERAGE_CATEGORY_SPECS['Carbonated (Cans)'] }
  if (['beer', 'alcohol', 'liquor', 'wine', 'spirit'].some((k) => low.includes(k))) return { category: 'Alcohol', ...BEVERAGE_CATEGORY_SPECS['Alcohol'] }
  if (low.includes('energy')) return { category: 'Energy Drinks', ...BEVERAGE_CATEGORY_SPECS['Energy Drinks'] }
  if (low.includes('sport')) return { category: 'Sport Drinks', ...BEVERAGE_CATEGORY_SPECS['Sport Drinks'] }
  if (low.includes('water') || low.includes('juice')) return { category: 'Water', ...BEVERAGE_CATEGORY_SPECS['Water'] }
  return { category: 'Carbonated (PET/PLASTIC)', ...BEVERAGE_CATEGORY_SPECS['Carbonated (PET/PLASTIC)'] }
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
