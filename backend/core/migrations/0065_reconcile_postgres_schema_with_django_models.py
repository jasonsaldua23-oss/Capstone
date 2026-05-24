from django.db import migrations


def _quote(identifier: str) -> str:
    return '"' + str(identifier).replace('"', '""') + '"'


def _table_exists(cursor, table_name: str) -> bool:
    cursor.execute(
        """
        select 1
        from information_schema.tables
        where table_schema = 'public' and table_name = %s
        """,
        [table_name],
    )
    return cursor.fetchone() is not None


def _column_meta(cursor, table_name: str, column_name: str):
    cursor.execute(
        """
        select data_type, udt_name
        from information_schema.columns
        where table_schema = 'public' and table_name = %s and column_name = %s
        """,
        [table_name, column_name],
    )
    return cursor.fetchone()


def _column_exists(cursor, table_name: str, column_name: str) -> bool:
    return _column_meta(cursor, table_name, column_name) is not None


def _constraint_exists(cursor, table_name: str, constraint_name: str) -> bool:
    cursor.execute(
        """
        select 1
        from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = %s and c.conname = %s
        """,
        [table_name, constraint_name],
    )
    return cursor.fetchone() is not None


def _rename_table(cursor, old_name: str, new_name: str) -> None:
    if _table_exists(cursor, old_name) and not _table_exists(cursor, new_name):
        cursor.execute(f"alter table {_quote(old_name)} rename to {_quote(new_name)}")


def _rename_column(cursor, table_name: str, old_name: str, new_name: str) -> None:
    if (
        _table_exists(cursor, table_name)
        and _column_exists(cursor, table_name, old_name)
        and not _column_exists(cursor, table_name, new_name)
    ):
        cursor.execute(
            f"alter table {_quote(table_name)} rename column {_quote(old_name)} to {_quote(new_name)}"
        )


def _add_column(cursor, table_name: str, column_name: str, definition: str) -> None:
    if _table_exists(cursor, table_name) and not _column_exists(cursor, table_name, column_name):
        cursor.execute(
            f"alter table {_quote(table_name)} add column {_quote(column_name)} {definition}"
        )


def _alter_column_to_varchar(cursor, table_name: str, column_name: str, length: int) -> None:
    meta = _column_meta(cursor, table_name, column_name)
    if not meta:
        return
    data_type, udt_name = meta
    if data_type == "character varying" and udt_name == "varchar":
        return
    cursor.execute(
        f"""
        alter table {_quote(table_name)}
        alter column {_quote(column_name)} type varchar({int(length)})
        using {_quote(column_name)}::text
        """
    )


def _alter_column_to_timestamptz(cursor, table_name: str, column_name: str) -> None:
    meta = _column_meta(cursor, table_name, column_name)
    if not meta:
        return
    data_type, _ = meta
    if data_type == "timestamp with time zone":
        return
    if data_type != "timestamp without time zone":
        return
    cursor.execute(
        f"""
        alter table {_quote(table_name)}
        alter column {_quote(column_name)} type timestamptz
        using case
            when {_quote(column_name)} is null then null
            else {_quote(column_name)} at time zone 'UTC'
        end
        """
    )


def reconcile_postgres_schema(apps, schema_editor) -> None:
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return

    with connection.cursor() as cursor:
        _rename_table(cursor, "Return", "Replacement")

        rename_map = {
            "User": {
                "isActive": "is_active",
                "lastLoginAt": "last_login_at",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "Customer": {
                "zipCode": "zip_code",
                "isActive": "is_active",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "Feedback": {
                "customerId": "customer_id",
                "orderId": "order_id",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "Warehouse": {
                "zipCode": "zip_code",
                "managerId": "manager_id",
                "isActive": "is_active",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "Product": {
                "imageUrl": "image_url",
                "isActive": "is_active",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "Inventory": {
                "warehouseId": "warehouse_id",
                "productId": "product_id",
                "reservedQuantity": "reserved_quantity",
                "lastRestockedAt": "last_restocked_at",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "InventoryTransaction": {
                "warehouseId": "warehouse_id",
                "productId": "product_id",
                "referenceType": "reference_type",
                "referenceId": "reference_id",
                "performedBy": "performed_by",
                "createdAt": "created_at",
            },
            "StockBatch": {
                "batchNumber": "batch_number",
                "inventoryId": "inventory_id",
                "receiptDate": "receipt_date",
                "expiryDate": "expiry_date",
                "locationLabel": "location_label",
                "createdBy": "created_by",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "Order": {
                "orderNumber": "order_number",
                "customerId": "customer_id",
                "shippingCost": "shipping_cost",
                "totalAmount": "total_amount",
                "paymentStatus": "payment_status",
                "warehouseId": "warehouse_id",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "OrderTimeline": {
                "orderId": "order_id",
                "confirmedAt": "confirmed_at",
                "processedAt": "processed_at",
                "shippedAt": "shipped_at",
                "deliveryDate": "delivery_date",
                "deliveredAt": "delivered_at",
                "cancelledAt": "cancelled_at",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "OrderItem": {
                "orderId": "order_id",
                "productId": "product_id",
                "unitPrice": "unit_price",
                "totalPrice": "total_price",
                "createdAt": "created_at",
            },
            "Vehicle": {
                "licensePlate": "license_plate",
                "isActive": "is_active",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "Trip": {
                "tripNumber": "trip_number",
                "driverId": "driver_id",
                "vehicleId": "vehicle_id",
                "warehouseId": "warehouse_id",
                "startLatitude": "start_latitude",
                "startLongitude": "start_longitude",
                "plannedStartAt": "planned_start_at",
                "actualStartAt": "actual_start_at",
                "actualEndAt": "actual_end_at",
                "totalDropPoints": "total_drop_points",
                "completedDropPoints": "completed_drop_points",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "TripDropPoint": {
                "tripId": "trip_id",
                "orderId": "order_id",
                "dropPointType": "drop_point_type",
                "locationName": "location_name",
                "zipCode": "zip_code",
                "contactName": "contact_name",
                "contactPhone": "contact_phone",
                "actualArrival": "actual_arrival",
                "actualDeparture": "actual_departure",
                "recipientName": "recipient_name",
                "deliveryPhoto": "delivery_photo",
                "failureReason": "failure_reason",
                "failureNotes": "failure_notes",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
            "LocationLog": {
                "driverId": "driver_id",
                "tripId": "trip_id",
                "recordedAt": "recorded_at",
            },
            "Notification": {
                "userId": "user_id",
                "customerId": "customer_id",
                "referenceType": "reference_type",
                "referenceId": "reference_id",
                "isRead": "is_read",
                "readAt": "read_at",
                "createdAt": "created_at",
            },
            "Replacement": {
                "returnNumber": "replacement_number",
                "orderId": "order_id",
                "customerId": "customer_id",
                "requestedBy": "requested_by",
                "replacementMode": "replacement_mode",
                "originalOrderItemId": "original_order_item_id",
                "replacementProductId": "replacement_product_id",
                "replacementQuantity": "replacement_quantity",
                "damagePhotoUrl": "damage_photo_url",
                "tripId": "trip_id",
                "dropPointId": "drop_point_id",
                "pickupAddress": "pickup_address",
                "pickupCity": "pickup_city",
                "pickupProvince": "pickup_province",
                "pickupZipCode": "pickup_zip_code",
                "pickupCompleted": "pickup_completed",
                "processedAt": "processed_at",
                "processedBy": "processed_by",
                "createdAt": "created_at",
                "updatedAt": "updated_at",
            },
        }

        for table_name, mapping in rename_map.items():
            for old_name, new_name in mapping.items():
                _rename_column(cursor, table_name, old_name, new_name)

        if _table_exists(cursor, "Inventory") and not _column_exists(cursor, "Inventory", "threshold"):
            if _column_exists(cursor, "Inventory", "minStock"):
                _rename_column(cursor, "Inventory", "minStock", "threshold")
            elif _column_exists(cursor, "Inventory", "reorderPoint"):
                _rename_column(cursor, "Inventory", "reorderPoint", "threshold")
            else:
                _add_column(cursor, "Inventory", "threshold", "integer not null default 10")

        replacement_model = apps.get_model("core", "Replacement")
        if not _table_exists(cursor, "Replacement"):
            schema_editor.create_model(replacement_model)

        add_columns = {
            "User": {
                "license_photo_url": "text",
                "role": "varchar(50) not null default 'CUSTOMER'",
                "license_number": "varchar(120)",
                "license_type": "varchar(20)",
                "license_expiry": "timestamptz",
                "emergency_contact": "varchar(255)",
                "rating": "double precision not null default 5.0",
                "total_deliveries": "integer not null default 0",
                "hired_at": "timestamptz",
            },
            "Product": {
                "sizes": "jsonb not null default '[]'::jsonb",
                "quantity_per_unit": "integer",
            },
            "Inventory": {
                "loose_bottles": "integer not null default 0",
            },
            "InventoryTransaction": {
                "driver_id": "text",
            },
            "Order": {
                "shipping_name": "varchar(255)",
                "shipping_phone": "varchar(100)",
                "shipping_address": "text",
                "shipping_city": "varchar(100)",
                "shipping_province": "varchar(100)",
                "shipping_zip_code": "varchar(20)",
                "shipping_country": "varchar(100) not null default 'Philippines'",
                "shipping_latitude": "double precision",
                "shipping_longitude": "double precision",
                "notes": "text",
                "special_instructions": "text",
                "pod_recipient_name": "varchar(255)",
                "pod_photo_url": "text",
                "pod_submitted_at": "timestamptz",
                "warehouse_stage": "varchar(50) not null default 'READY_TO_LOAD'",
                "ready_to_load_at": "timestamptz",
                "loaded_at": "timestamptz",
                "warehouse_dispatched_at": "timestamptz",
                "checklist_quantity_verified": "boolean not null default false",
                "dispatch_signed_off_by": "varchar(255)",
                "dispatch_signed_off_user_id": "varchar(100)",
                "dispatch_signed_off_at": "timestamptz",
                "exception_short_load_qty": "integer not null default 0",
                "exception_damaged_on_loading_qty": "integer not null default 0",
                "exception_hold_reason": "text",
                "exception_notes": "text",
            },
            "OrderItem": {
                "product_name": "varchar(255)",
                "product_sku": "varchar(100)",
                "product_unit": "varchar(50)",
            },
            "Vehicle": {
                "driver_id": "text",
            },
            "Replacement": {
                "damage_photo_urls": "text",
            },
        }

        for table_name, mapping in add_columns.items():
            for column_name, definition in mapping.items():
                _add_column(cursor, table_name, column_name, definition)

        varchar_columns = {
            "Feedback": {"type": 50},
            "Order": {"status": 50},
            "Vehicle": {"type": 50, "status": 50},
            "Trip": {"status": 50},
            "TripDropPoint": {"drop_point_type": 50, "status": 50},
            "Replacement": {"status": 50},
        }
        for table_name, mapping in varchar_columns.items():
            for column_name, length in mapping.items():
                _alter_column_to_varchar(cursor, table_name, column_name, length)

        timestamptz_columns = {
            "User": ["license_expiry", "hired_at", "last_login_at", "created_at", "updated_at"],
            "Customer": ["discount_updated_at", "created_at", "updated_at"],
            "Feedback": ["created_at", "updated_at"],
            "Warehouse": ["created_at", "updated_at"],
            "Product": ["created_at", "updated_at"],
            "Inventory": ["last_restocked_at", "created_at", "updated_at"],
            "InventoryTransaction": ["created_at"],
            "StockBatch": ["receipt_date", "expiry_date", "created_at", "updated_at"],
            "Order": [
                "pod_submitted_at",
                "ready_to_load_at",
                "loaded_at",
                "warehouse_dispatched_at",
                "dispatch_signed_off_at",
                "created_at",
                "updated_at",
            ],
            "OrderTimeline": [
                "confirmed_at",
                "processed_at",
                "shipped_at",
                "delivery_date",
                "delivered_at",
                "cancelled_at",
                "created_at",
                "updated_at",
            ],
            "OrderItem": ["created_at"],
            "Vehicle": ["created_at", "updated_at"],
            "Trip": ["planned_start_at", "actual_start_at", "actual_end_at", "created_at", "updated_at"],
            "TripDropPoint": ["actual_arrival", "actual_departure", "created_at", "updated_at"],
            "LocationLog": ["recorded_at"],
            "Notification": ["read_at", "created_at"],
            "Replacement": ["pickup_completed", "processed_at", "created_at", "updated_at"],
        }
        for table_name, columns in timestamptz_columns.items():
            for column_name in columns:
                _alter_column_to_timestamptz(cursor, table_name, column_name)

        if _table_exists(cursor, "User") and _column_exists(cursor, "User", "role"):
            if _table_exists(cursor, "Role") and _column_exists(cursor, "User", "roleId"):
                cursor.execute(
                    """
                    update "User" as u
                    set role = r.name
                    from "Role" as r
                    where u."roleId" = r.id
                    """
                )
            if _table_exists(cursor, "Driver") and _column_exists(cursor, "Driver", "userId"):
                cursor.execute(
                    """
                    update "User" as u
                    set
                        role = case
                            when coalesce(nullif(u.role, ''), 'CUSTOMER') = 'CUSTOMER' then 'DRIVER'
                            else u.role
                        end,
                        license_number = coalesce(nullif(u.license_number, ''), d."licenseNumber"),
                        license_type = coalesce(nullif(u.license_type, ''), d."licenseType"),
                        license_expiry = coalesce(u.license_expiry, d."licenseExpiry" at time zone 'UTC'),
                        emergency_contact = coalesce(nullif(u.emergency_contact, ''), d."emergencyContact"),
                        rating = case when d."rating" is not null then d."rating" else u.rating end,
                        total_deliveries = case when d."totalDeliveries" is not null then d."totalDeliveries" else u.total_deliveries end,
                        hired_at = coalesce(u.hired_at, d."hiredAt" at time zone 'UTC'),
                        is_active = coalesce(d."isActive", u.is_active),
                        phone = coalesce(nullif(u.phone, ''), d."phone")
                    from "Driver" as d
                    where d."userId" = u.id
                    """
                )
            cursor.execute(
                """
                update "User"
                set role = 'CUSTOMER'
                where role is null or btrim(role) = ''
                """
            )

        if _table_exists(cursor, "Vehicle") and _table_exists(cursor, "DriverVehicle") and _table_exists(cursor, "Driver"):
            cursor.execute(
                """
                update "Vehicle" as v
                set driver_id = x.user_id
                from (
                    select distinct on (dv."vehicleId")
                        dv."vehicleId" as vehicle_id,
                        d."userId" as user_id
                    from "DriverVehicle" as dv
                    join "Driver" as d on d.id = dv."driverId"
                    where coalesce(dv."isActive", true)
                    order by dv."vehicleId", dv."assignedAt" desc nulls last, dv.id
                ) as x
                where v.id = x.vehicle_id and coalesce(nullif(v.driver_id, ''), '') = ''
                """
            )

        if _table_exists(cursor, "Order") and _table_exists(cursor, "OrderLogistics"):
            cursor.execute(
                """
                update "Order" as o
                set
                    shipping_name = coalesce(o.shipping_name, l."shippingName"),
                    shipping_phone = coalesce(o.shipping_phone, l."shippingPhone"),
                    shipping_address = coalesce(o.shipping_address, l."shippingAddress"),
                    shipping_city = coalesce(o.shipping_city, l."shippingCity"),
                    shipping_province = coalesce(o.shipping_province, l."shippingProvince"),
                    shipping_zip_code = coalesce(o.shipping_zip_code, l."shippingZipCode"),
                    shipping_country = coalesce(nullif(o.shipping_country, ''), l."shippingCountry", 'Philippines'),
                    shipping_latitude = coalesce(o.shipping_latitude, l."shippingLatitude"),
                    shipping_longitude = coalesce(o.shipping_longitude, l."shippingLongitude"),
                    notes = coalesce(o.notes, l."notes"),
                    special_instructions = coalesce(o.special_instructions, l."specialInstructions")
                from "OrderLogistics" as l
                where l."orderId" = o.id
                """
            )
        if _table_exists(cursor, "Order") and _table_exists(cursor, "Customer"):
            cursor.execute(
                """
                update "Order" as o
                set
                    shipping_name = coalesce(o.shipping_name, c.name),
                    shipping_phone = coalesce(o.shipping_phone, c.phone),
                    shipping_address = coalesce(o.shipping_address, c.address),
                    shipping_city = coalesce(o.shipping_city, c.city),
                    shipping_province = coalesce(o.shipping_province, c.province),
                    shipping_zip_code = coalesce(o.shipping_zip_code, c.zip_code),
                    shipping_country = coalesce(nullif(o.shipping_country, ''), c.country, 'Philippines'),
                    shipping_latitude = coalesce(o.shipping_latitude, c.latitude),
                    shipping_longitude = coalesce(o.shipping_longitude, c.longitude)
                from "Customer" as c
                where o.customer_id = c.id
                """
            )
        if _table_exists(cursor, "Order"):
            cursor.execute(
                """
                update "Order"
                set warehouse_stage = case
                    when status = 'OUT_FOR_DELIVERY' then 'DISPATCHED'
                    when status = 'DELIVERED' then 'DISPATCHED'
                    else coalesce(nullif(warehouse_stage, ''), 'READY_TO_LOAD')
                end
                """
            )

        if _table_exists(cursor, "OrderItem") and _table_exists(cursor, "Product"):
            cursor.execute(
                """
                update "OrderItem" as oi
                set
                    product_name = coalesce(oi.product_name, p.name),
                    product_sku = coalesce(oi.product_sku, p.sku),
                    product_unit = coalesce(oi.product_unit, p.unit)
                from "Product" as p
                where oi.product_id = p.id
                """
            )

        if _table_exists(cursor, "TripDropPoint") and _table_exists(cursor, "Order"):
            cursor.execute(
                """
                update "Order" as o
                set
                    pod_recipient_name = coalesce(o.pod_recipient_name, dp.recipient_name),
                    pod_photo_url = coalesce(o.pod_photo_url, dp.delivery_photo),
                    pod_submitted_at = coalesce(o.pod_submitted_at, dp.actual_departure, dp.actual_arrival)
                from (
                    select distinct on (order_id)
                        order_id,
                        recipient_name,
                        delivery_photo,
                        actual_departure,
                        actual_arrival,
                        created_at
                    from "TripDropPoint"
                    where order_id is not null
                    order by order_id, coalesce(actual_departure, actual_arrival, created_at) desc nulls last
                ) as dp
                where o.id = dp.order_id
                """
            )

        if _table_exists(cursor, "Order") and _column_exists(cursor, "Order", "status"):
            cursor.execute(
                """
                update "Order"
                set status = case status
                    when 'PROCESSING' then 'PREPARING'
                    when 'PACKED' then 'PREPARING'
                    when 'DISPATCHED' then 'OUT_FOR_DELIVERY'
                    else status
                end
                """
            )

        if _table_exists(cursor, "Replacement"):
            if _column_exists(cursor, "Replacement", "damage_photo_urls") and _column_exists(cursor, "Replacement", "damage_photo_url"):
                cursor.execute(
                    """
                    update "Replacement"
                    set damage_photo_urls = to_jsonb(array[damage_photo_url])::text
                    where
                        damage_photo_url is not null
                        and btrim(damage_photo_url) <> ''
                        and (damage_photo_urls is null or btrim(damage_photo_urls) = '')
                    """
                )
            if _column_exists(cursor, "Replacement", "status"):
                cursor.execute(
                    """
                    update "Replacement"
                    set status = case status
                        when 'REQUESTED' then 'REPORTED'
                        when 'PICKED_UP' then 'IN_PROGRESS'
                        when 'IN_TRANSIT' then 'IN_PROGRESS'
                        when 'RECEIVED' then 'UNDER_REVIEW'
                        when 'PROCESSED' then 'COMPLETED'
                        else status
                    end
                    """
                )

        if _table_exists(cursor, "Product") and _column_exists(cursor, "Product", "sizes"):
            cursor.execute(
                """
                update "Product"
                set sizes = '[]'::jsonb
                where sizes is null
                """
            )

        if _table_exists(cursor, "User") and not _constraint_exists(cursor, "User", "user_license_number_unique"):
            cursor.execute(
                """
                alter table "User"
                add constraint user_license_number_unique unique (license_number)
                """
            )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0064_remove_driver_spare_stock_and_replacements"),
    ]

    operations = [
        migrations.RunPython(reconcile_postgres_schema, migrations.RunPython.noop),
    ]
