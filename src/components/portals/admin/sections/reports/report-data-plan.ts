// Fix: report tabs declare their real data dependencies so opening Purchase
// Requests does not wait for unrelated stock, trip, feedback, or retail queries.
export const REPORT_DATASETS = {
  orders: { endpoint: '/api/orders', keys: ['orders'] },
  trips: { endpoint: '/api/trips?limit=1000', keys: ['trips'] },
  drivers: { endpoint: '/api/drivers?limit=500&includeSample=true', keys: ['drivers'] },
  warehouses: { endpoint: '/api/warehouses?limit=200', keys: ['warehouses'] },
  inventory: { endpoint: '/api/inventory?limit=1000', keys: ['inventory'] },
  inventoryTransactions: { endpoint: '/api/inventory-transactions?limit=1000', keys: ['transactions'] },
  replacements: { endpoint: '/api/replacements?limit=1000', keys: ['replacements'] },
  feedback: { endpoint: '/api/feedback?limit=1000', keys: ['feedback'] },
  // The endpoint returns stockBatches, not batches; keep the real collection key first.
  stockBatches: { endpoint: '/api/stock-batches?page=1&pageSize=2000', keys: ['stockBatches', 'batches'] },
  customers: { endpoint: '/api/customers?limit=1000', keys: ['customers', 'users'] },
  retailSales: { endpoint: '/api/retail/sales?limit=1000', keys: ['sales', 'retailSales'] },
}

export type ReportDataset = keyof typeof REPORT_DATASETS

export const REPORT_DEPENDENCIES: Record<string, readonly ReportDataset[]> = {
  purchase_requests: ['orders'],
  purchase_orders: ['orders'],
  orders: ['orders'],
  transactions: ['orders', 'retailSales'],
  logistics: ['trips', 'drivers', 'warehouses'],
  transport: ['trips', 'drivers'],
  replacement_records: ['replacements', 'orders'],
  replacement: ['replacements', 'orders'],
  retail_sales: ['orders', 'retailSales'],
  top_clients: ['orders', 'customers'],
  warehouse: ['warehouses', 'inventory', 'inventoryTransactions'],
  inventory: ['inventory', 'inventoryTransactions', 'stockBatches', 'warehouses', 'orders', 'retailSales'],
  feedback: ['feedback', 'orders', 'trips'],
}
