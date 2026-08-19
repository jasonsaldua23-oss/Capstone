# Spec: Retail POS, Offline Pickup, Empty Bottles, Deposits, and Mixed Cases

**Author:** Codex with repository-derived constraints  
**Date:** 2026-08-19  
**Status:** Approved — recommendations D-1, D-2, and D-3 approved by the project owner  
**Reviewer:** Project owner  
**Related spec:** `docs/rgb-returnable-glass-bottles-phase2.md`

## Context

Warehouse staff need a fast sales channel for walk-in and offline pickup transactions. The new channel must use the same products, category-derived packaging, stock batches, reservations, mixed-case components, deposit configuration, bottle-return records, and inventory transaction history as existing customer orders. It must not introduce a parallel catalog, stock ledger, or deposit table.

The repository already contains most of those primitives, but the migration state requires reconciliation before POS work. Database migrations 0079–0089 are applied, while the runtime models omit a number of fields introduced by those migrations. The currently unapplied migration 0090 proposes deleting the mixed-case, reservation, purchase workflow, and RGB/deposit schema. Applying 0090 would destroy the exact source-of-truth data required by this feature.

The product model currently has one `price` value and does not distinguish an individual retail price from a full-case price. The RGB configuration has both per-bottle and per-case deposits, but the required formula for partially covered full cases is not defined. Those decisions are recorded under “Approval Required.”

## Approved Decisions

- D-1 — Product pricing source:
  - Option A: add explicit `retail_unit_price` and `case_price` configuration to the existing Product registration flow.
  - Option B: keep `Product.price` as the case/pack price and derive the loose price as `price / quantity_per_unit`.
  - Recommendation: **A**, because it avoids inventing a loose retail price and preserves the registered price as authoritative.
- D-2 — Partial empty coverage for a full case whose registered case deposit differs from bottle deposit × case quantity:
  - Option A: prorate the registered case deposit by uncovered bottles: `case_deposit × uncovered / case_capacity`.
  - Option B: charge the registered case deposit, then credit each returned empty at the registered bottle-deposit rate.
  - Recommendation: **A**, because the registered case deposit remains authoritative and coverage reaches exactly zero when all required empties are supplied.
- D-3 — Walk-in customer accounting:
  - Option A: allow POS orders and RGB return/deposit audit records to have no Customer account, while snapshotting walk-in name/contact on the order.
  - Option B: create a shared “Walk-in Customer” account.
  - Recommendation: **A**, because a shared account would combine unrelated customers’ bottle and deposit balances.

Approval includes replacing the destructive, unapplied migration 0090 with a non-destructive reconciliation migration and making the nullable/additive schema changes described below.

## Functional Requirements

- FR-1: The implementation MUST restore the Django model declarations to the applied 0089 database state and MUST NOT apply the current destructive migration 0090.
- FR-2: The system MUST add `Retail / POS` to the Warehouse Staff sidebar and MUST restrict its APIs and UI to authenticated, active warehouse staff with an assigned warehouse.
- FR-3: Staff MUST be able to select an active existing customer or enter an optional walk-in name, contact number, and notes.
- FR-4: The POS product search MUST read active products and available-to-sell quantities from the existing Product, ProductPackaging, PackagingProfile, Inventory, StockBatch, and InventoryReservation records.
- FR-5: A cart line MUST identify its sale mode as `LOOSE`, `CASE`, or `MIXED_CASE` and MUST snapshot product, category, packaging, quantity, price, and deposit data at checkout.
- FR-6: Loose sales MUST be allowed only when the product’s existing packaging/category configuration supports a physical loose unit.
- FR-7: Case sales MUST use the registered case capacity and MUST deduct that number of base units per case from the existing inventory.
- FR-8: Mixed cases MUST contain only active, case-based Glass Bottle products with the same category-derived compatibility key and a supported case capacity.
- FR-9: A mixed-case quantity MUST exactly fill one or more supported case capacities; incomplete cases MUST be rejected.
- FR-10: Mixed-case inventory MUST be reserved and consumed per component product; the system MUST NOT create a generic mixed-case stock movement.
- FR-11: Product pricing MUST come from the approved D-1 source and MUST be snapshotted on each line/component.
- FR-12: Deposit eligibility and values MUST come from the existing active ProductPackaging/ContainerType configuration; the POS MUST NOT accept a manually entered deposit rate.
- FR-13: Alcohol products MUST have zero deposit, MUST NOT require empties, and MUST be excluded from bottle balance changes.
- FR-14: Staff MUST be able to enter returned empty quantities per eligible container/product allocation, from zero through the eligible new-bottle quantity.
- FR-15: Returned empties MUST NOT exceed the eligible new-bottle quantity in the same sale.
- FR-16: Loose-item deposit MUST equal `max(eligible bottles - accepted empties, 0) × registered bottle deposit`.
- FR-17: Full-case deposit with no empties MUST use the registered case deposit when it is greater than zero; partial coverage MUST follow approved D-2.
- FR-18: Mixed-case deposit MUST be calculated from its actual eligible component bottles and their snapshotted configured rates; it MUST reach zero when every eligible bottle is covered by an accepted compatible empty.
- FR-19: The quote and checkout summary MUST show product total, empty bottles provided, deposit charged, grand total, fulfillment, payment status, amount paid, and remaining balance.
- FR-20: An immediate sale MUST atomically consume inventory once, create per-product `OUT` transactions, record accepted empties, record deposit audit entries, and mark the retail order completed.
- FR-21: A customer-pickup sale MUST atomically reserve inventory, reduce available-to-sell stock, and start at `PENDING_PICKUP` without consuming stock.
- FR-22: Pickup status transitions MUST be limited to `PENDING_PICKUP → READY_FOR_PICKUP → PICKED_UP_COMPLETED`, with cancellation allowed before completion.
- FR-23: Completing pickup MUST consume the existing reservations exactly once and MUST NOT deduct inventory a second time.
- FR-24: Payment status MUST be derived as `UNPAID` when amount paid is zero, `PARTIALLY_PAID` when it is between zero and grand total, and `PAID` when it equals grand total; overpayment and negative payment MUST be rejected.
- FR-25: Accepted empties MUST create traceable records in the existing BottleReturn/BottleReturnLine and deposit transaction paths, linked to the retail order, staff member, warehouse, customer snapshot/account, and timestamp.
- FR-26: Cancelling a reserved pickup MUST release reservations and create audit records without consuming inventory.
- FR-27: Cancelling a completed sale MUST create compensating inventory, deposit, and bottle-return audit entries; it MUST NOT delete or silently rewrite original movements.
- FR-28: All create, payment, pickup-completion, and cancellation commands MUST be idempotent.
- FR-29: Retail history MUST list and filter retail transactions and MUST expose a complete detail view without showing POS transactions in Purchase Requests, Purchase Orders, transportation, or delivery routing.
- FR-30: The receipt MUST show business name, retail transaction number, timestamp, customer/walk-in snapshot, staff, item/component details, packaging, product total, empties, deposit (including zero), grand total, payment state, and pickup state.
- FR-31: The existing Inventory Transaction History MUST show each retail component movement with its physical unit label and retail transaction reference.
- FR-32: The warehouse dashboard MAY add today’s retail sales, retail count, pending/completed pickups, deposit collected, and empties returned using the same retail order records.

## Non-Functional Requirements

- NFR-1: Sale creation, reservation/consumption, deposit entries, return entries, and payment snapshot MUST execute inside one database transaction; any failure MUST roll back all effects.
- NFR-2: Inventory rows and affected ledger/balance rows MUST be locked during mutation to prevent overselling and balance drift under concurrent requests.
- NFR-3: Monetary calculations MUST use Decimal values and round to PHP centavos with `ROUND_HALF_UP`; JavaScript floating-point values MUST NOT be authoritative.
- NFR-4: Retail list endpoints MUST be paginated with a default of 25 and maximum of 100 records per request.
- NFR-5: Every interactive POS control MUST be keyboard operable, have an accessible name, and expose validation errors using `aria-describedby` or an alert region.
- NFR-6: Existing non-retail API request/response fields and order behavior MUST remain backward compatible; POS fields MUST be additive and existing lists MUST explicitly filter by sales channel where required.
- NFR-7: Audit records MUST retain immutable product, packaging, price, deposit, customer/walk-in, warehouse, and staff snapshots after source records change or are deleted.

## Acceptance Criteria

### AC-1: Safe schema baseline (FR-1, NFR-6)
Given migrations 0079–0089 are applied and 0090 is unapplied  
When the POS migration plan is checked  
Then no applied mixed-case, reservation, purchase workflow, RGB, or deposit table/column is scheduled for removal  
And the next migration contains only reconciliation and approved additive/nullable POS changes.

### AC-2: Authorized POS access (FR-2)
Given an active Warehouse Staff user with an assigned warehouse  
When they open the warehouse portal  
Then `Retail / POS` is visible and its APIs return only data scoped to that warehouse.

### AC-3: Unauthorized POS access (FR-2)
Given an unauthenticated user, customer, driver, admin without the permitted warehouse role, or staff without an assigned warehouse  
When they call a retail endpoint  
Then the request returns 401 or 403 and creates no records.

### AC-4: Existing and walk-in customers (FR-3)
Given the POS customer step  
When staff selects an existing active customer or enters walk-in details  
Then the quote and finalized order carry the selected account or immutable walk-in snapshot without creating a duplicate customer account.

### AC-5: Central product and stock source (FR-4, NFR-4)
Given active and inactive products with on-hand and reserved stock  
When staff searches the POS catalog  
Then only active products are returned and availability equals existing allocatable base-unit stock.

### AC-6: Valid loose and case lines (FR-5, FR-6, FR-7, FR-11)
Given an eligible configured product  
When staff adds a loose quantity or full-case quantity  
Then the quote uses the registered capacity and approved price source and returns immutable display snapshots.

### AC-7: Valid mixed case (FR-8, FR-9, FR-10)
Given two compatible case-based Glass Bottle products with capacity 12  
When staff builds 6 + 6 bottles  
Then one mixed case is accepted and each component retains its own product identity.

### AC-8: Invalid mixed case (FR-8, FR-9)
Given a PET, Can, Alcohol, non-case, incompatible, inactive, or insufficiently filled component selection  
When staff requests a mixed-case quote  
Then the request returns 400 with a specific validation message and no reservation is created.

### AC-9: Deposit configuration and alcohol exemption (FR-12, FR-13)
Given an eligible configured glass product and an Alcohol product  
When both are quoted  
Then the glass deposit comes from ProductPackaging and Alcohol deposit and required empties are zero.

### AC-10: No, full, and partial empty coverage (FR-14, FR-15, FR-16)
Given 12 eligible loose bottles at ₱2 deposit each  
When accepted empties are respectively 0, 12, and 8  
Then deposits are respectively ₱24, ₱0, and ₱8  
And entering 13 returns 400.

### AC-11: Full-case deposit (FR-17)
Given a full case with a registered ₱90 case deposit  
When zero empties are accepted  
Then the deposit is ₱90 rather than bottle deposit × capacity  
And partial coverage follows approved D-2.

### AC-12: Mixed-case deposit (FR-18)
Given a valid 12-bottle mixed case  
When 12 compatible empties are accepted  
Then the deposit is ₱0  
And when only 8 are accepted only four component bottles remain deposit-bearing according to their snapshots.

### AC-13: Checkout totals (FR-19, FR-24, NFR-3)
Given a quoted cart  
When amount paid is entered  
Then product total + deposit equals grand total, payment status is derived, remaining balance is exact to two decimals, and negative/overpayment is rejected.

### AC-14: Immediate sale atomicity (FR-20, FR-25, FR-31, NFR-1, NFR-2)
Given sufficient stock and valid payment data  
When an immediate sale is completed  
Then stock is consumed once, each actual product gets an OUT transaction, accepted empties and deposit movements are recorded, and the sale is completed  
And any failure leaves all stock and financial/return records unchanged.

### AC-15: Pickup reservation lifecycle (FR-21, FR-22, FR-23, NFR-2)
Given sufficient available stock  
When a pickup sale is created and later moved through ready to completed  
Then stock is reserved at creation, remains unavailable to other sales, and is consumed exactly once at completion.

### AC-16: Reservation oversell prevention (FR-21, NFR-2)
Given two concurrent pickup requests for the final available units  
When both attempt checkout  
Then at most one succeeds and the other receives an insufficient-inventory conflict.

### AC-17: Cancellation compensation (FR-26, FR-27)
Given a reserved pickup or completed immediate sale  
When authorized staff cancels it  
Then reservations are released or compensating stock/deposit/return movements are created, originals remain immutable, and the final transaction is cancelled.

### AC-18: Idempotency (FR-28)
Given a successful command with an idempotency key  
When the identical command is submitted again  
Then the original response/reference is returned and no stock, payment, deposit, or return effect is duplicated.

### AC-19: Retail isolation and history (FR-29)
Given online orders and retail orders both exist  
When retail history and Purchase Order/transportation lists are opened  
Then retail history contains only retail orders with complete filters/details and retail orders do not appear in delivery workflows.

### AC-20: Receipt and audit labels (FR-30, FR-31, NFR-7)
Given a completed sale whose product is later renamed  
When its receipt and inventory movements are opened  
Then they show the original product, packaging, price, deposit, customer/walk-in, warehouse, staff, and component snapshots, including `Deposit: ₱0.00` where applicable.

### AC-21: Dashboard summaries (FR-32)
Given retail transactions for the current warehouse and date  
When the warehouse dashboard loads  
Then any implemented retail cards aggregate the same retail order records and do not duplicate transaction data.

## Edge Cases and Error Scenarios

- EC-1: Product missing, deleted, inactive, or changed since quote → checkout returns 409 and requires a fresh quote.
- EC-2: Deposit/packaging configuration changed since quote → checkout returns 409 and does not silently use stale client totals.
- EC-3: Zero, negative, non-integer, or overflowing quantities → return 400; create no records.
- EC-4: Empty count exceeds eligible purchased containers → return 400 with the maximum permitted count.
- EC-5: Empty container type incompatible with the purchased container allocation → return 400.
- EC-6: Stock becomes insufficient between quote and checkout → return 409 after row locking; no partial sale.
- EC-7: Payment amount has more than two decimals → normalize on the server using NFR-3 or reject malformed numeric input.
- EC-8: Repeating a pickup completion/cancellation → return the current resource state without repeating side effects.
- EC-9: Cancellation with accepted physical empties → require staff confirmation that the compensating empty-return action matches the actual physical hand-back/correction.
- EC-10: Database error during any mutation → roll back the entire command and return a generic 500 without exposing internals.
- EC-11: Walk-in with blank optional identity fields → allow the sale and display `Walk-in Customer`.
- EC-12: Existing customer becomes inactive after quote → checkout returns 409; walk-in mode may be selected instead.
- EC-13: Alcohol in a Glass Bottle category → deposit remains zero and no BottleReturnLine is created for that line.

## API Contracts

All endpoints require the existing staff bearer/cookie authentication and warehouse authorization.

```ts
type SaleMode = "LOOSE" | "CASE" | "MIXED_CASE";
type FulfillmentType = "IMMEDIATE" | "CUSTOMER_PICKUP";
type PickupStatus = "NOT_APPLICABLE" | "PENDING_PICKUP" | "READY_FOR_PICKUP" | "PICKED_UP_COMPLETED" | "CANCELLED";
type RetailPaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "PAID";
type RetailTransactionStatus = "OPEN" | "RESERVED" | "COMPLETED" | "CANCELLED";

interface RetailComponentInput {
  productId: string;
  quantityBaseUnits: number;
  emptyBottlesProvided: number;
}

interface RetailCartLineInput {
  mode: SaleMode;
  productId?: string;              // Required for LOOSE/CASE
  quantity: number;                // Loose units, cases, or mixed case count
  caseCapacity?: number;           // Required for MIXED_CASE
  emptyBottlesProvided?: number;   // LOOSE/CASE allocation
  components?: RetailComponentInput[];
}

interface RetailQuoteRequest {
  customerId?: string;
  customerType: "EXISTING" | "WALK_IN";
  walkIn?: { name?: string; contactNumber?: string; notes?: string };
  fulfillmentType: FulfillmentType;
  items: RetailCartLineInput[];
}

interface RetailMoneySummary {
  productTotal: string;
  deposit: string;
  grandTotal: string;
  amountPaid: string;
  remainingBalance: string;
  paymentStatus: RetailPaymentStatus;
}

interface CreateRetailSaleRequest extends RetailQuoteRequest {
  idempotencyKey: string;
  quoteToken: string;
  amountPaid: string;
}
```

- `GET /api/retail/products?search=&page=1&pageSize=25`
  - 200: paginated active products with category/packaging, existing configured prices/deposits, case capacity, supported modes, and allocatable base units.
- `POST /api/retail/quote`
  - 200: normalized lines/components, server snapshots, `RetailMoneySummary`, validation metadata, and short-lived signed `quoteToken`.
  - 400: malformed/invalid cart; 404: source record missing; 409: insufficient inventory/config conflict.
- `POST /api/retail/sales`
  - 201: finalized retail sale, inventory/deposit/return references, receipt payload.
  - 400/403/409 as above; repeated idempotency key returns the original sale.
- `GET /api/retail/sales?page=1&pageSize=25&search=&paymentStatus=&fulfillmentType=&pickupStatus=&status=&dateFrom=&dateTo=`
  - 200: warehouse-scoped paginated retail history.
- `GET /api/retail/sales/{id}`
  - 200: complete snapshotted sale details and audit references; 404 when absent/out of scope.
- `PATCH /api/retail/sales/{id}/payment`
  - Request: `{ idempotencyKey: string; amountPaid: string }`; 200 with recomputed status/balance.
- `PATCH /api/retail/sales/{id}/pickup-status`
  - Request: `{ idempotencyKey: string; pickupStatus: PickupStatus }`; 200 after a valid transition.
- `POST /api/retail/sales/{id}/cancel`
  - Request: `{ idempotencyKey: string; reason: string; emptiesRestoredToCustomer?: boolean }`; 200 with compensating movement references.

Errors use the existing `{ success: false, error: string }` response convention and MUST include a clear user-facing validation message.

## Data Models

The implementation reuses `Order` as the sales transaction aggregate, `OrderItem`/`MixedCaseComponent` as line records, and existing reservation, inventory, RGB, and deposit records. The name “Retail Sale” is a channel/view, not a duplicate inventory or order database.

### Order (additive/nullable changes)

| Field | Type | Constraints |
|---|---|---|
| customer | FK Customer nullable | Existing online orders remain non-null; nullable only for walk-in POS |
| sales_channel | enum | Existing default `ONLINE`; new value `RETAIL_POS`; indexed |
| fulfillment_type | enum nullable | `IMMEDIATE`, `CUSTOMER_PICKUP`; required for POS |
| pickup_status | enum | Default `NOT_APPLICABLE`; indexed |
| retail_status | enum nullable | `OPEN`, `RESERVED`, `COMPLETED`, `CANCELLED`; indexed |
| walk_in_name | varchar(255) nullable | Snapshot; optional |
| walk_in_contact | varchar(100) nullable | Snapshot; optional PII |
| walk_in_notes | text nullable | Snapshot; optional |
| amount_paid | decimal(12,2) | Default 0, non-negative |
| remaining_balance | decimal(12,2) | Snapshotted server result, non-negative |
| created_by_user | FK User nullable | Required for POS; PROTECT/SET_NULL with staff-name snapshot |
| created_by_name | varchar(255) nullable | Immutable receipt/audit snapshot |
| retail_transaction_number | varchar(120) nullable | Unique when present, format `POS-YYYY-NNNN` |
| retail_request_id | varchar(120) nullable | Unique idempotency key |
| cancelled_by / cancelled_at / cancellation_reason | nullable audit fields | Required when cancelled |

### OrderItem (restore applied fields and add snapshots)

| Field | Type | Constraints |
|---|---|---|
| item_type | enum | Restore `STANDARD_CASE`/`MIXED_CASE`; extend with `LOOSE` only if required by approved design |
| case_capacity and RGB deposit fields | existing applied fields | Restore declarations from migrations 0083/0085 |
| product_category | varchar(150) nullable | Immutable snapshot |
| packaging_type_snapshot | varchar(100) nullable | Immutable physical packaging snapshot |
| sale_mode | enum nullable | `LOOSE`, `CASE`, `MIXED_CASE`; required for POS |
| product_subtotal | decimal(12,2) | Price excluding deposit |
| deposit_total | decimal(12,2) | Uncovered configured deposit |
| empty_covered_quantity | positive integer | Cannot exceed eligible quantity |

### Existing models restored/reused

| Model | POS use |
|---|---|
| Product / ProductPackaging / ContainerType / PackagingProfile | Catalog, modes, capacity, packaging, authoritative deposits and approved prices |
| Inventory / StockBatch | Central on-hand stock |
| InventoryReservation | Pickup and mixed/loose reservations |
| InventoryTransaction | Per-product reserve/consume/release/reversal audit with snapshots |
| MixedCaseComponent | Per-product contents, prices, packaging and quantities |
| BottleReturn / BottleReturnLine | Physical empties accepted with retail order reference |
| DepositTransaction / CustomerDepositLedger / CustomerBottleBalance | Existing-customer financial and physical balances; walk-in behavior follows approved D-3 |

For approved D-3 Option A, `BottleReturn.customer`, `DepositTransaction.customer`, and `DepositTransaction.ledger` become nullable for walk-in POS audit entries; account ledger/balance updates are skipped, while order/item deposit snapshots remain authoritative for the transaction.

## Out of Scope

- OS-1: A separate POS product, inventory, deposit, or customer database — prohibited by the requirement.
- OS-2: Card gateway, e-wallet gateway, cash drawer, barcode scanner, printer driver, or accounting integration — no provider/hardware contract was supplied.
- OS-3: Standalone empty returns that exceed bottles purchased in the current POS sale — existing bottle-return workflows remain responsible for those returns.
- OS-4: Customer Portal, Driver app, or Admin Portal redesign — only shared serializers/history filters needed for compatibility are included.
- OS-5: Delivery routing for POS orders — immediate and warehouse pickup transactions never enter transportation.
- OS-6: Arbitrary partial/incomplete mixed cases — explicitly prohibited.
- OS-7: Manual deposit-rate entry in POS — explicitly prohibited.
- OS-8: Physical cash refunds for cancellation/overpayment — no cash-management rules were supplied; only audited payment balance state is included.
