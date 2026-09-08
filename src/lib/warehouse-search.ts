export type WarehouseSearchResult = {
  id: string
  kind: 'purchaseRequests' | 'orders' | 'inventory'
  label: string
  description: string
}

// Search only the already-scoped records supplied by the warehouse portal.
export function searchWarehouseRecords(query: string, orders: any[], inventory: any[]): WarehouseSearchResult[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const matches = (values: unknown[]) => {
    const text = values.map((value) => String(value ?? '')).join(' ').replace(/_/g, ' ').toLowerCase()
    return terms.every((term) => text.includes(term))
  }
  const results: WarehouseSearchResult[] = []
  for (const order of orders) {
    const items = Array.isArray(order.items) ? order.items : []
    if (!matches([order.id, order.orderNumber, order.purchaseOrderNumber, order.customer?.name, order.status, order.requestStatus,
      ...items.flatMap((item: any) => [item.productName, item.product?.name, item.product?.sku])])) continue
    const isPurchaseOrder = String(order.requestStatus || order.request_status || '').toUpperCase() === 'APPROVED'
      && Boolean(order.purchaseOrderNumber || order.purchase_order_number)
      && Boolean(order.purchaseOrderStage || order.purchase_order_stage)
    results.push({
      id: String(order.id), kind: isPurchaseOrder ? 'orders' : 'purchaseRequests',
      label: String(order.purchaseOrderNumber || order.orderNumber || order.id),
      description: `${isPurchaseOrder ? 'Purchase order' : 'Request'} · ${order.customer?.name || 'Customer'} · ${String(order.status || '').replace(/_/g, ' ')}`,
    })
  }
  for (const item of inventory) {
    if (!matches([item.id, item.product?.name, item.product?.sku])) continue
    results.push({ id: String(item.id), kind: 'inventory', label: String(item.product?.name || item.product?.sku || item.id), description: `Inventory · ${item.product?.sku || ''}` })
  }
  return results
}
