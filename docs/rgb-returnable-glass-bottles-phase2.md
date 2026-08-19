# Phase 2: RGB (Returnable Glass Bottle) Support — Design Specification

## Table of Contents
1. Revised Data Model
2. Workflow Documentation
3. New/Modified UI Screens
4. Edge Cases & Business Rules
5. Migration/Rollout Risks

---

## 1. Revised Data Model

### 1.1 New Models

#### ContainerType
*Net-new model. Represents the physical container (bottle, crate) as a distinct entity.*

| Field | Type | Notes |
|-------|------|-------|
| id | CharField (PK, CUID) | Auto-generated |
| code | CharField (unique, max 50) | e.g., "GLASS_BOTTLE_355ML", "CRATE_24" |
| name | CharField (max 255) | e.g., "Glass Bottle 355ml", "Plastic Crate (24-slot)" |
| category | CharField (max 50) | `BOTTLE` or `CRATE` |
| material | CharField (max 50) | `GLASS`, `PLASTIC`, `ALUMINUM` |
| volume_ml | Float (nullable) | For bottles — e.g., 355, 1000 |
| capacity_units | Integer (nullable) | For crates — e.g., 24 bottles per crate |
| deposit_amount | Decimal (max_digits=10, decimal_places=2) | Monetary deposit per unit (e.g., ₱15 per bottle) |
| is_returnable | Boolean (default=True) | Whether this container type participates in the deposit system |
| expected_lifespan_cycles | Integer (nullable) | Expected number of reuse cycles before retirement |
| is_active | Boolean (default=True) | |
| created_at | DateTime | |
| updated_at | DateTime | |

#### ProductPackaging
*Net-new model. Links a Product to its ContainerType(s) and marks returnability. Replaces the need to add fields directly to Product.*

| Field | Type | Notes |
|-------|------|-------|
| id | CharField (PK, CUID) | |
| product | ForeignKey → Product | One product can have multiple packaging options |
| container_type | ForeignKey → ContainerType | The bottle/crate used |
| packaging_profile | ForeignKey → PackagingProfile (nullable) | Links to existing packaging profile for case structure |
| units_per_container | Integer | e.g., 1 (bottle), 24 (crate) |
| containers_per_case | Integer | e.g., 24 bottles per case |
| is_primary | Boolean (default=False) | Which packaging is the default for ordering |
| is_returnable | Boolean (default=False) | Derived from container_type.is_returnable but can be overridden |
| deposit_amount | Decimal (max_digits=10, decimal_places=2) | Deposit per container unit at this product level |
| is_active | Boolean (default=True) | |
| created_at | DateTime | |
| updated_at | DateTime | |

**Unique constraint**: (product, container_type)

#### CustomerDepositLedger
*Net-new model. Running monetary deposit balance per customer.*

| Field | Type | Notes |
|-------|------|-------|
| id | CharField (PK, CUID) | |
| customer | ForeignKey → Customer | |
| balance | Decimal (max_digits=12, decimal_places=2, default=0) | Current deposit balance (positive = customer owes us, negative = we owe customer) |
| currency | CharField (max=3, default="PHP") | |
| last_transaction_at | DateTime (nullable) | |
| created_at | DateTime | |
| updated_at | DateTime | |

**Unique constraint**: customer (one ledger per customer)

#### DepositTransaction
*Net-new model. Every deposit movement is recorded here for full auditability.*

| Field | Type | Notes |
|-------|------|-------|
| id | CharField (PK, CUID) | |
| customer | ForeignKey → Customer | |
| ledger | ForeignKey → CustomerDepositLedger | |
| type | CharField (max=30) | `CHARGE` (new bottles sold), `REFUND` (empties returned), `ADJUSTMENT` (manual correction), `WRITE_OFF` (bad debt) |
| amount | Decimal (max_digits=10, decimal_places=2) | Positive = customer charged, Negative = customer refunded |
| balance_before | Decimal (max_digits=12, decimal_places=2) | |
| balance_after | Decimal (max_digits=12, decimal_places=2) | |
| order | ForeignKey → Order (nullable) | Reference order if applicable |
| order_item | ForeignKey → OrderItem (nullable) | Specific line item if applicable |
| container_type | ForeignKey → ContainerType (nullable) | Which container type this transaction relates to |
| container_count | Integer (nullable) | Number of containers involved |
| reason | TextField | Human-readable reason |
| reference_type | CharField (max=50, nullable) | e.g., "order", "return_receipt", "manual_adjustment" |
| reference_id | CharField (max=25, nullable) | ID of the reference record |
| performed_by | CharField (max=100, nullable) | User who performed the action |
| created_at | DateTime | |

#### CustomerBottleBalance
*Net-new model. Physical count of outstanding empties owed per customer, per container type.*

| Field | Type | Notes |
|-------|------|-------|
| id | CharField (PK, CUID) | |
| customer | ForeignKey → Customer | |
| container_type | ForeignKey → ContainerType | |
| bottles_outstanding | Integer (default=0) | Number of containers the customer has but hasn't returned |
| bottles_returned_total | Integer (default=0) | Lifetime count of returned containers |
| bottles_sold_total | Integer (default=0) | Lifetime count of containers sold to customer |
| last_return_at | DateTime (nullable) | |
| created_at | DateTime | |
| updated_at | DateTime | |

**Unique constraint**: (customer, container_type)

#### BottleReturn
*Net-new model. A return transaction for empty containers, separate from Replacement (damaged goods).*

| Field | Type | Notes |
|-------|------|-------|
| id | CharField (PK, CUID) | |
| return_number | CharField (unique, max=120) | Auto-generated: "RTR-YYYY-NNNN" |
| customer | ForeignKey → Customer | |
| order | ForeignKey → Order (nullable) | The delivery order this return is associated with |
| trip | ForeignKey → Trip (nullable) | The trip that collected the empties |
| drop_point | ForeignKey → TripDropPoint (nullable) | The specific stop where empties were collected |
| status | CharField (max=30) | `PENDING`, `GRADED`, `PARTIALLY_ACCEPTED`, `ACCEPTED`, `REJECTED` |
| received_by | CharField (max=100, nullable) | Driver or warehouse staff who received the return |
| received_at | DateTime (nullable) | |
| notes | TextField (nullable) | |
| created_at | DateTime | |
| updated_at | DateTime | |

#### BottleReturnLine
*Net-new model. Individual line items within a bottle return.*

| Field | Type | Notes |
|-------|------|-------|
| id | CharField (PK, CUID) | |
| bottle_return | ForeignKey → BottleReturn | |
| container_type | ForeignKey → ContainerType | |
| quantity_claimed | Integer | What the customer says they're returning |
| quantity_graded_reusable | Integer (default=0) | Counted as reusable after grading |
| quantity_graded_damaged | Integer (default=0) | Counted as damaged/broken after grading |
| quantity_rejected | Integer (default=0) | Counted as unacceptable (wrong type, foreign object) |
| deposit_refund_amount | Decimal (max_digits=10, decimal_places=2, default=0) | Actual refund for reusable containers |
| notes | TextField (nullable) | |
| created_at | DateTime | |

### 1.2 Modified Models (Extended)

#### Product (extended)
| New Field | Type | Notes |
|-----------|------|-------|
| packaging_type | CharField (max=20, default="NON_RETURNABLE") | `RETURNABLE` or `NON_RETURNABLE` — quick filter flag |

*No other changes to Product. The container relationship is handled by ProductPackaging.*

#### PackagingProfile (extended)
| New Field | Type | Notes |
|-----------|------|-------|
| is_returnable | Boolean (default=False) | Whether this packaging profile is for returnable containers |
| default_deposit_amount | Decimal (max_digits=10, decimal_places=2, default=0) | Default deposit per base unit |

#### OrderItem (extended)
| New Field | Type | Notes |
|-----------|------|-------|
| is_returnable_item | Boolean (default=False) | Whether this line item involves returnable containers |
| container_type_id | CharField (max=25, nullable) | FK to ContainerType (stored as char for snapshot) |
| container_type_name | CharField (max=255, nullable) | Snapshot |
| full_quantity | Integer (default=0) | Quantity of full bottles/crates delivered |
| empty_returned_quantity | Integer (default=0) | Quantity of empties returned in this transaction |
| deposit_per_unit | Decimal (max_digits=10, decimal_places=2, default=0) | Deposit amount per container at time of order |
| deposit_charged | Decimal (max_digits=10, decimal_places=2, default=0) | Total deposit charged (full_quantity × deposit_per_unit) |
| deposit_refunded | Decimal (max_digits=10, decimal_places=2, default=0) | Total deposit refunded (empty_returned_quantity × deposit_per_unit) |
| net_deposit | Decimal (max_digits=10, decimal_places=2, default=0) | deposit_charged - deposit_refunded |

#### Customer (extended)
| New Field | Type | Notes |
|-----------|------|-------|
| bottle_balance_threshold | Integer (default=0, nullable) | Max outstanding empties before new RGB orders are blocked. 0 = no limit. |
| deposit_override_percent | Decimal (max_digits=5, decimal_places=2, default=0, nullable) | Optional per-customer deposit discount (e.g., 10% off deposit) |

#### TripDropPoint (extended)
| New Field | Type | Notes |
|-----------|------|-------|
| empties_collected | Boolean (default=False) | Whether empties were collected at this stop |
| bottle_return_id | CharField (max=25, nullable) | Reference to the BottleReturn record |

### 1.3 Entity Relationship Diagram (Text)

```
Customer (1) ────── (1) CustomerDepositLedger
Customer (1) ────── (N) CustomerBottleBalance
Customer (1) ────── (N) DepositTransaction
Customer (1) ────── (N) BottleReturn
Customer (1) ────── (N) Order

Product (1) ────── (N) ProductPackaging (N) ────── (1) ContainerType
Product (1) ────── (N) PackagingProfile (existing)

Order (1) ────── (N) OrderItem (extended)
Order (1) ────── (N) BottleReturn (nullable)

Trip (1) ────── (N) TripDropPoint (extended)
TripDropPoint (1) ────── (1) BottleReturn (nullable)

BottleReturn (1) ────── (N) BottleReturnLine (N) ────── (1) ContainerType

DepositTransaction (N) ────── (1) Order (nullable)
DepositTransaction (N) ────── (1) OrderItem (nullable)
DepositTransaction (N) ────── (1) ContainerType (nullable)
```

---

## 2. Workflow Documentation

### 2.1 Order Entry with Returns (Customer Checkout)

#### Flow

```
1. Customer browses products
   ├── Products with packaging_type=RETURNABLE show a "Returnable" badge
   └── Product detail shows: price, deposit amount per container, case configuration

2. Customer adds RGB product to cart
   ├── Cart item shows: product price + deposit amount
   └── Deposit is displayed separately from product price

3. Customer proceeds to checkout
   ├── For each RGB line item, two quantity fields are shown:
   │   ├── "Full bottles/crates to deliver" (required, min 1)
   │   └── "Empty bottles/crates to return" (optional, min 0)
   ├── System validates: empty_returned ≤ customer's current outstanding balance for that container type
   │   └── If empty_returned > outstanding, show warning but allow (over-return creates credit)
   ├── Deposit calculation:
   │   ├── deposit_charged = full_quantity × deposit_per_unit
   │   ├── deposit_refunded = empty_returned_quantity × deposit_per_unit
   │   └── net_deposit = deposit_charged - deposit_refunded
   ├── Order summary shows:
   │   ├── Product subtotal
   │   ├── Deposit charged
   │   ├── Deposit refunded
   │   └── Net deposit due
   └── Customer confirms order

4. Backend order creation (new logic in service layer):
   ├── Create Order + OrderItem records (existing flow)
   ├── For RGB items, populate new OrderItem fields (full_quantity, empty_returned_quantity, etc.)
   ├── Create DepositTransaction for CHARGE (full containers)
   ├── Create DepositTransaction for REFUND (returned empties)
   ├── Update CustomerDepositLedger.balance
   ├── Update CustomerBottleBalance:
   │   ├── bottles_outstanding += full_quantity - empty_returned_quantity
   │   ├── bottles_sold_total += full_quantity
   │   └── bottles_returned_total += empty_returned_quantity
   └── Reserve inventory (existing flow — deposit doesn't affect physical inventory)
```

#### Business Rules

- **Mixed-cart orders**: RGB and non-RGB items are handled in the same order. Deposit logic only applies to items where `is_returnable_item=True`.
- **Partial returns**: If customer returns fewer empties than they have outstanding, the shortfall stays on their balance.
- **Over-returns**: If customer returns more empties than outstanding, the excess creates a negative balance (credit). The system allows this but flags for review.
- **Order edits/cancellations**:
  - If order is PENDING and not yet confirmed: cancellation releases deposit charges/refunds, reverses balance changes.
  - If order is CONFIRMED or later: cancellation requires admin approval, deposit transactions are reversed with ADJUSTMENT type.
  - Partial edits: Not supported in v1. Customer must cancel and re-order.

### 2.2 Returns Processing / Grading

#### Driver Collection Flow

```
1. Driver arrives at drop point
2. Driver selects "Collect Empties" option
3. Driver sees customer's outstanding bottle balance per container type
4. Driver enters claimed quantities (what customer says they're returning)
5. Driver grades each container:
   ├── Reusable (passes visual inspection) → counts toward refund
   ├── Damaged (cracked, broken, chipped) → counted but no refund
   └── Rejected (wrong brand, foreign object, severely contaminated) → not counted
6. Driver captures photo evidence for damaged/rejected items (optional)
7. Driver confirms collection → BottleReturn created with status GRADED
8. System updates:
   ├── CustomerBottleBalance.bottles_outstanding -= quantity_graded_reusable
   ├── CustomerBottleBalance.bottles_returned_total += quantity_graded_reusable + quantity_graded_damaged
   ├── DepositTransaction: REFUND for reusable quantity
   └── CustomerDepositLedger.balance -= deposit_refund_amount
9. Empties loaded onto truck for return to warehouse
```

#### Warehouse Receiving Flow

```
1. Driver returns to warehouse with collected empties
2. Warehouse staff verifies the graded quantities
3. If discrepancy found:
   ├── Minor (<5% variance): Accept driver's grading, log note
   ├── Major (≥5% variance): Create adjustment, flag for review
   └── Discrepancy resolved via BottleReturnLine notes
4. Reusable containers are cleaned and added back to inventory:
   ├── Inventory.loose_bottles += quantity_graded_reusable (for the container product)
   └── Or a separate ContainerInventory model tracks container stock
5. Damaged containers are disposed/recycled
6. Rejected containers are returned to customer or disposed
```

#### Grading Rules

| Grade | Refund? | Counts toward return? | Notes |
|-------|---------|----------------------|-------|
| Reusable | Yes (full deposit) | Yes | Passes visual inspection, no cracks, clean |
| Damaged | No (configurable) | Yes (reduces outstanding) | Cracked, broken, chipped, excessive wear |
| Rejected | No | No (still outstanding) | Wrong brand, foreign object, severe contamination |

### 2.3 Driver Collection Sync

#### Online Flow

```
1. Driver app sends BottleReturn data via PATCH /api/trips/{tripId}/drop-points/{dropPointId}
   ├── empties_collected: true
   ├── bottle_return_data: { lines: [...] }
   └── (Reuses existing drop point update endpoint with new fields)
2. Backend processes synchronously:
   ├── Creates BottleReturn + BottleReturnLine records
   ├── Updates CustomerBottleBalance
   ├── Creates DepositTransaction records
   └── Returns success with updated balances
3. Customer portal refreshes via data sync channel
```

#### Offline/Conflict Resolution

```
1. Driver app queues BottleReturn data locally
2. On reconnection, sends queued data with idempotency key (client-generated UUID)
3. Backend checks for duplicate request_id → idempotent
4. If concurrent update detected (e.g., customer service also processed a return):
   ├── Last-write-wins for bottle balance (with audit trail)
   ├── Both transactions recorded in DepositTransaction log
   └── Alert generated for admin review if balance goes negative beyond threshold
```

---

## 3. New/Modified UI Screens

### 3.1 Customer Portal

| Screen | Type | Description |
|--------|------|-------------|
| Product card (home) | Modified | Show "Returnable" badge, display deposit amount below price |
| Add to cart dialog | Modified | Show deposit breakdown, allow entering return quantity |
| Cart view | Modified | Show deposit line items per RGB product, separate from product price |
| Checkout view | Modified | Add "Empty bottles to return" field per RGB item, show net deposit calculation |
| Order details dialog | Modified | Show deposit charged/refunded per line item, outstanding balance after order |
| Bottle balance view | New | Customer-facing view of their current bottle balance per container type |
| Deposit ledger view | New | Customer-facing transaction history of deposit movements |

### 3.2 Admin Portal

| Screen | Type | Description |
|--------|------|-------------|
| Products view | Modified | Add packaging_type filter, container type management |
| Product edit dialog | Modified | Add container type assignment, deposit amount, returnability settings |
| Container types view | New | CRUD for ContainerType entities |
| Customer detail view | Modified | Show bottle balance, deposit ledger, threshold settings |
| Customer bottle balance report | New | Per-customer outstanding empties with aging |
| Deposit liability report | New | Aggregate financial liability from outstanding deposits |
| Return rate report | New | % returned vs sold, per customer and aggregate |
| Aging report | New | Empties held beyond configurable days |
| Bottle returns view | New | List of all bottle returns with grading details, filterable by status |

### 3.3 Driver Portal

| Screen | Type | Description |
|--------|------|-------------|
| Trip detail view | Modified | Add "Collect Empties" button per drop point (when order has RGB items) |
| Empty collection dialog | New | Modal for entering claimed quantities, grading each container, capturing photos |
| Collection summary | New | Summary of empties collected during the trip |

### 3.4 Warehouse Portal

| Screen | Type | Description |
|--------|------|-------------|
| Bottle returns verification | New | List of pending returns needing warehouse verification |
| Return grading dialog | New | Verify/reject driver's grading, process damaged/rejected items |
| Container inventory view | New | Stock levels of reusable containers at warehouse |

---

## 4. Edge Cases, Data Integrity Risks & Business Rules

### 4.1 Edge Cases

| Scenario | Handling |
|----------|----------|
| **Customer at threshold** | New RGB order is blocked with message: "You have {N} outstanding bottles. Please return empties before ordering more returnable products." Configurable threshold per customer. |
| **Customer exactly at threshold** | Treated same as "at or above threshold" — blocked. Threshold = 0 means no limit. |
| **Customer has negative balance (credit)** | Allowed. Customer has returned more than they've purchased. No blocking. |
| **Customer returns empties from a different brand's bottle** | Rejected during grading. Customer is informed, bottle is not counted. |
| **Driver grades incorrectly (fraud/collusion)** | Warehouse verification step catches discrepancies. Audit trail in BottleReturnLine notes. |
| **Bottle broken during transport after grading** | Driver notes the breakage. Damaged grade applied retroactively if within same trip. |
| **Customer disputes grading** | Admin can manually adjust via ADJUSTMENT transaction type. Full audit trail. |
| **Order with RGB items is cancelled after delivery** | Deposit transactions are reversed. Bottle balance is adjusted. Requires admin approval. |
| **Partial delivery of RGB order** | Only delivered quantity counts for deposit charging. Undelivered items are handled via existing order adjustment flow. |
| **Container type changes deposit amount** | The deposit_per_unit is snapshotted on OrderItem at order time. Future returns use the rate at time of return, not the original purchase rate. (Configurable — can be set to use original rate.) |
| **Customer returns more than outstanding** | Over-return creates negative outstanding (credit). System allows but flags for admin review. |
| **Mixed return (reusable + damaged + rejected in same batch)** | Each category tracked separately in BottleReturnLine. Refund only for reusable. |

### 4.2 Data Integrity Risks

| Risk | Mitigation |
|------|------------|
| **Double-counting returns** | Idempotency key (request_id) on BottleReturn creation. Unique constraint on (bottle_return, container_type) per line. |
| **Balance drift between deposit ledger and bottle balance** | Daily reconciliation job that compares CustomerDepositLedger.balance vs sum of (CustomerBottleBalance.bottles_outstanding × deposit_per_unit). Alert on mismatch > ₱100. |
| **Concurrent updates to customer balance** | `select_for_update()` on CustomerDepositLedger and CustomerBottleBalance within atomic transactions. |
| **Inventory mismatch after returns** | Returned reusable containers are added to inventory via existing InventoryTransaction mechanism (type="RETURN"). |
| **Race condition: driver and customer service process return simultaneously** | Last-write-wins with audit trail. Both transactions recorded. Admin alert generated. |
| **Historical data backfill** | Existing customers with no RGB history start with zero balances. No backfill needed for pre-RGB orders. |

### 4.3 Recommended Business Rules (Where Requirements Are Ambiguous)

| Rule | Recommendation |
|------|----------------|
| **Deposit rate for returns** | Use the deposit rate at time of return (not time of purchase). This handles deposit amount changes gracefully. |
| **Damaged container refund** | Default: No refund for damaged containers, but outstanding count is reduced. Configurable per customer. |
| **Rejected container handling** | Rejected containers remain on customer's outstanding balance. Customer must retrieve them. |
| **Threshold enforcement** | Hard block at order creation time. Soft warning at checkout. Admin can override. |
| **Deposit on mixed-case orders** | Mixed cases can contain RGB and non-RGB products. Deposit applies only to RGB components. |
| **Crate deposits** | If crates themselves have deposit value (common in some markets), model crate as a separate ContainerType with its own deposit amount. |
| **Rounding** | All monetary values rounded to 2 decimal places (PHP centavo). Container counts are whole numbers only. |
| **Negative balance handling** | Negative balance = credit owed to customer. Can be applied to future orders or cashed out. Configurable minimum for cash-out. |

---

## 5. Migration/Rollout Risks

### 5.1 Backfilling Historical Data

| Item | Risk | Approach |
|------|------|----------|
| **Pre-RGB orders** | No deposit data exists for historical orders | No backfill needed. RGB is a new product attribute. Existing non-RGB products remain unchanged. |
| **Customer bottle balances** | No historical balance to start from | All customers start with zero balance. First RGB order establishes the initial balance. |
| **Container inventory** | No existing container stock tracking | Physical inventory count at rollout. Initial stock entered via manual adjustment. |
| **Deposit ledger** | No historical deposit transactions | Ledger starts empty. First RGB transaction creates the ledger record. |

### 5.2 In-Flight Orders During Deployment

| Scenario | Handling |
|----------|----------|
| **Order created before deployment, delivered after** | No RGB items in pre-deployment orders. No impact. |
| **Order with RGB items in progress during deployment** | Deploy during low-activity window. Any in-progress orders without RGB items are unaffected. |
| **Active trips during deployment** | Driver app update may be required. Coordinate deployment with driver app update. |

### 5.3 Backward Compatibility

| Concern | Approach |
|---------|----------|
| **Existing non-RGB products** | Unchanged. `packaging_type` defaults to `NON_RETURNABLE`. |
| **Existing API endpoints** | New fields are optional. Existing clients that don't send RGB data continue to work. |
| **Existing order flow** | Unchanged for non-RGB items. RGB logic is additive. |
| **Existing reports** | Unchanged. New reports are additive. |
| **Mobile apps** | Driver app needs update for empty collection UI. Customer app needs update for deposit display. Web-first rollout with mobile to follow. |

### 5.4 Deployment Sequence

```
Phase 2a: Data Model & Backend (Week 1-2)
├── Create new models (ContainerType, ProductPackaging, CustomerDepositLedger, etc.)
├── Extend existing models (Product, OrderItem, Customer, PackagingProfile, TripDropPoint)
├── Create migrations
├── Implement service layer functions (deposit calculation, balance management, return processing)
├── Add API endpoints (or extend existing ones)
└── Write unit tests

Phase 2b: Admin Portal (Week 3)
├── Container type management UI
├── Product packaging configuration UI
├── Customer bottle balance view
├── Reports (bottle balance, deposit liability, aging, return rate)
└── Admin override/adjustment UI

Phase 2c: Customer Portal (Week 4)
├── Product card updates (returnable badge, deposit display)
├── Cart/checkout updates (return quantity field, deposit breakdown)
├── Order details updates (deposit per line item)
├── Bottle balance view
├── Deposit ledger view
└── Threshold blocking logic

Phase 2d: Driver Portal (Week 5)
├── Empty collection UI at drop point
├── Grading interface (reusable/damaged/rejected)
├── Photo capture for damaged items
├── Offline queue for collection data
└── Collection summary view

Phase 2e: Warehouse Portal (Week 6)
├── Return verification interface
├── Grading discrepancy resolution
├── Container inventory view
└── Integration with existing inventory receiving

Phase 2f: Testing & Rollout (Week 7)
├── Integration testing
├── Load testing (deposit calculation under concurrent orders)
├── UAT with pilot customers
├── Data reconciliation job deployment
├── Monitoring & alerting setup
└── Go-live
```

---

## Summary of Changes

| Category | Count | Details |
|----------|-------|---------|
| **New models** | 6 | ContainerType, ProductPackaging, CustomerDepositLedger, DepositTransaction, CustomerBottleBalance, BottleReturn, BottleReturnLine |
| **Extended models** | 5 | Product, PackagingProfile, OrderItem, Customer, TripDropPoint |
| **New service functions** | ~10 | calculate_deposit, process_bottle_return, grade_containers, update_bottle_balance, check_order_threshold, reconcile_balances, etc. |
| **New API endpoints** | ~5 | BottleReturn CRUD, DepositLedger query, Balance check, Reports |
| **Modified API endpoints** | ~3 | Order creation (extended), Trip drop point update (extended), Customer profile (extended) |
| **New UI screens** | ~10 | Customer: bottle balance, deposit ledger. Admin: container types, returns, 4 reports. Driver: collection dialog. Warehouse: verification. |
| **Modified UI screens** | ~8 | Product card, cart, checkout, order details, trip detail, customer detail, product edit, add-to-cart dialog |