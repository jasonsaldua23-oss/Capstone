import { readFileSync, writeFileSync } from 'fs'

const file = 'src/components/portals/admin/sections/replacements-view.tsx'
let content = readFileSync(file, 'utf8')

// The old block: qtyPerUnitFromFields ... return fallback > 0 ? ... : '0'
const oldBlock = `    const qtyPerUnitFromFields = Number(first?.qtyPerUnit ?? first?.quantityPerUnit ?? entry?.qtyPerUnit ?? entry?.quantityPerUnit ?? meta?.qtyPerUnit ?? meta?.quantityPerUnit ?? NaN)
    const qtyPerUnit = Number.isFinite(qtyPerUnitFromFields) && qtyPerUnitFromFields > 0 ? qtyPerUnitFromFields : (qtyPerUnitMatch ? Number(qtyPerUnitMatch[1]) : NaN)
    const qtyPerCaseFromFields = Number(first?.qtyPerCase ?? first?.quantityPerCase ?? entry?.qtyPerCase ?? entry?.quantityPerCase ?? meta?.qtyPerCase ?? meta?.quantityPerCase ?? NaN)
    const qtyPerCase = Number.isFinite(qtyPerCaseFromFields) && qtyPerCaseFromFields > 0 ? qtyPerCaseFromFields : (qtyPerCaseMatch ? Number(qtyPerCaseMatch[1]) : NaN)
    const qtyPerPack = qtyPerPackMatch ? Number(qtyPerPackMatch[1]) : NaN
    const qtyPerBundle = qtyPerBundleMatch ? Number(qtyPerBundleMatch[1]) : NaN
    const unitLabel =
      unitHint.includes('pack') || byPackText ? 'pack(s)'
        : unitHint.includes('bundle') || byBundleText ? 'bundle(s)'
          : unitHint.includes('case') || byCaseText || byUnitText ? 'case(s)'
              : 'bottle(s)'

    const caseQty = Number(
      mode === 'toReplace'
        ? (first?.damagedCases ?? first?.quantityToReplaceCases ?? first?.replacementCases)
        : (first?.replacedCases ?? first?.quantityReplacedCases ?? first?.replacementCases)
    )
    const bottleQty = Number(
      mode === 'toReplace'
        ? (first?.damagedBottles ?? first?.quantityToReplaceBottles ?? first?.replacementBottles)
        : (first?.replacedBottles ?? first?.quantityReplacedBottles ?? first?.replacementBottles)
    )
    if (Number.isFinite(caseQty) && caseQty > 0) return \`\${caseQty} \${unitLabel}\`
    if (Number.isFinite(bottleQty) && bottleQty > 0) return \`\${bottleQty} bottle(s)\`

    const fallbackQty = Number(
      mode === 'toReplace'
        ? (entry?.quantityToReplace ?? meta?.quantityToReplace ?? entry?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
        : (entry?.quantityReplaced ?? meta?.quantityReplaced ?? entry?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
    )
    const fallback = Math.max(0, Number.isFinite(fallbackQty) ? fallbackQty : 0)
    if (byUnitText && Number.isFinite(qtyPerUnit) && qtyPerUnit > 0 && fallback > 0) return \`\${fallback / qtyPerUnit} \${unitLabel}\`
    if (byCaseText && Number.isFinite(qtyPerCase) && qtyPerCase > 0 && fallback > 0) return \`\${fallback / qtyPerCase} \${unitLabel}\`
    if (byPackText && Number.isFinite(qtyPerPack) && qtyPerPack > 0 && fallback > 0) return \`\${fallback / qtyPerPack} \${unitLabel}\`
    if (byBundleText && Number.isFinite(qtyPerBundle) && qtyPerBundle > 0 && fallback > 0) return \`\${fallback / qtyPerBundle} \${unitLabel}\`
    if (byBottleText) return \`\${fallback} bottle(s)\`
    return fallback > 0 ? \`\${fallback} \${unitLabel}\` : '0'`

const newBlock = `    // Read qtyPerUnit from all known data field names first, regex as fallback
    const qtyPerFromFields = Number(
      first?.qtyPerUnit ?? first?.quantityPerUnit ?? first?.quantityPerCase ??
      first?.unitsPerCase ?? first?.bottlesPerUnit ?? first?.bottlesPerCase ??
      entry?.qtyPerUnit ?? entry?.quantityPerUnit ?? entry?.quantityPerCase ??
      entry?.unitsPerCase ?? entry?.bottlesPerUnit ?? entry?.bottlesPerCase ??
      meta?.qtyPerUnit ?? meta?.quantityPerUnit ?? meta?.quantityPerCase ??
      meta?.unitsPerCase ?? meta?.bottlesPerUnit ?? meta?.bottlesPerCase ?? NaN
    )
    const qtyPerGenericMatch = contextText.match(/qty\\s*\\/\\s*(?:unit|case|pack|bundle)\\s*[:\\-]?\\s*(\\d+)/i)
    const qtyPerFromText = qtyPerGenericMatch ? Number(qtyPerGenericMatch[1]) : NaN
    const resolvedQtyPer = Number.isFinite(qtyPerFromFields) && qtyPerFromFields > 0 ? qtyPerFromFields : qtyPerFromText
    const qtyPerUnit = qtyPerUnitMatch ? Number(qtyPerUnitMatch[1]) : resolvedQtyPer
    const qtyPerCase = qtyPerCaseMatch ? Number(qtyPerCaseMatch[1]) : resolvedQtyPer
    const qtyPerPack = qtyPerPackMatch ? Number(qtyPerPackMatch[1]) : NaN
    const qtyPerBundle = qtyPerBundleMatch ? Number(qtyPerBundleMatch[1]) : NaN
    const unitLabel =
      unitHint.includes('pack') || byPackText ? 'pack(s)'
        : unitHint.includes('bundle') || byBundleText ? 'bundle(s)'
          : unitHint.includes('case') || byCaseText || byUnitText ? 'case(s)'
              : 'bottle(s)'

    const caseQty = Number(
      mode === 'toReplace'
        ? (first?.damagedCases ?? first?.quantityToReplaceCases ?? first?.replacementCases)
        : (first?.replacedCases ?? first?.quantityReplacedCases ?? first?.replacementCases)
    )
    const bottleQty = Number(
      mode === 'toReplace'
        ? (first?.damagedBottles ?? first?.quantityToReplaceBottles ?? first?.replacementBottles)
        : (first?.replacedBottles ?? first?.quantityReplacedBottles ?? first?.replacementBottles)
    )
    if (Number.isFinite(caseQty) && caseQty > 0) return \`\${caseQty} \${unitLabel}\`
    if (Number.isFinite(bottleQty) && bottleQty > 0) return \`\${bottleQty} bottle(s)\`

    const fallbackQty = Number(
      mode === 'toReplace'
        ? (entry?.quantityToReplace ?? meta?.quantityToReplace ?? entry?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
        : (entry?.quantityReplaced ?? meta?.quantityReplaced ?? entry?.replacementQuantity ?? meta?.replacementQuantity ?? 0)
    )
    const fallback = Math.max(0, Number.isFinite(fallbackQty) ? fallbackQty : 0)
    if (byBottleText) return \`\${fallback} bottle(s)\`
    // If qtyPerUnit found from fields (no keyword required) — always divide
    if (Number.isFinite(resolvedQtyPer) && resolvedQtyPer > 0 && fallback > 0) {
      const units = fallback / resolvedQtyPer
      const unitsText = Number.isInteger(units) ? String(units) : units.toFixed(2).replace(/\\.00$/, '')
      return \`\${unitsText} \${unitLabel}\`
    }
    if (byUnitText && Number.isFinite(qtyPerUnit) && qtyPerUnit > 0 && fallback > 0) return \`\${fallback / qtyPerUnit} \${unitLabel}\`
    if (byCaseText && Number.isFinite(qtyPerCase) && qtyPerCase > 0 && fallback > 0) return \`\${fallback / qtyPerCase} \${unitLabel}\`
    if (byPackText && Number.isFinite(qtyPerPack) && qtyPerPack > 0 && fallback > 0) return \`\${fallback / qtyPerPack} \${unitLabel}\`
    if (byBundleText && Number.isFinite(qtyPerBundle) && qtyPerBundle > 0 && fallback > 0) return \`\${fallback / qtyPerBundle} \${unitLabel}\`
    return fallback > 0 ? \`\${fallback} \${unitLabel}\` : '0'`

if (!content.includes(oldBlock)) {
  console.error('OLD BLOCK NOT FOUND — check for whitespace differences')
  process.exit(1)
}

content = content.replace(oldBlock, newBlock)
writeFileSync(file, content)
console.log('Done — getReplacementQtyDisplay updated successfully')
