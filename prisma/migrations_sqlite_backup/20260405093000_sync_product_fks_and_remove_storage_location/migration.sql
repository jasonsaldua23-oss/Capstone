PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

CREATE TABLE "new_Inventory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "minStock" INTEGER NOT NULL DEFAULT 10,
    "maxStock" INTEGER NOT NULL DEFAULT 100,
    "reorderPoint" INTEGER NOT NULL DEFAULT 20,
    "lastRestockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Inventory_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Inventory" (
    "id", "warehouseId", "productId", "quantity", "reservedQuantity",
    "minStock", "maxStock", "reorderPoint", "lastRestockedAt", "createdAt", "updatedAt"
)
SELECT
    "id", "warehouseId", "productId", "quantity", "reservedQuantity",
    "minStock", "maxStock", "reorderPoint", "lastRestockedAt", "createdAt", "updatedAt"
FROM "Inventory";

DROP TABLE "Inventory";
ALTER TABLE "new_Inventory" RENAME TO "Inventory";
CREATE UNIQUE INDEX "Inventory_warehouseId_productId_key" ON "Inventory"("warehouseId", "productId");

CREATE TABLE "new_InventoryTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "warehouseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "performedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryTransaction_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InventoryTransaction_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_InventoryTransaction" (
    "id", "warehouseId", "productId", "type", "quantity",
    "referenceType", "referenceId", "notes", "performedBy", "createdAt"
)
SELECT
    "id", "warehouseId", "productId", "type", "quantity",
    "referenceType", "referenceId", "notes", "performedBy", "createdAt"
FROM "InventoryTransaction";

DROP TABLE "InventoryTransaction";
ALTER TABLE "new_InventoryTransaction" RENAME TO "InventoryTransaction";

CREATE TABLE "new_OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    "totalPrice" REAL NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_OrderItem" (
    "id", "orderId", "productId", "quantity", "unitPrice",
    "totalPrice", "notes", "createdAt"
)
SELECT
    "id", "orderId", "productId", "quantity", "unitPrice",
    "totalPrice", "notes", "createdAt"
FROM "OrderItem";

DROP TABLE "OrderItem";
ALTER TABLE "new_OrderItem" RENAME TO "OrderItem";

DROP TABLE IF EXISTS "StorageLocation";

COMMIT;

PRAGMA foreign_keys=ON;
