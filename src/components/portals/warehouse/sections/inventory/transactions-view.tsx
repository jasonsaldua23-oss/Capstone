'use client'

import { InventoryTransactionsView } from '@/components/portals/admin/sections/inventory-transactions-view'

export { InventoryTransactionsView }

export function WarehouseInventoryTransactionsView(props: { userRole?: string; [key: string]: any }) {
  return <InventoryTransactionsView userRole={props.userRole || 'WAREHOUSE_STAFF'} />
}
