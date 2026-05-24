from django.db import migrations


def _quote(identifier: str) -> str:
    return '"' + str(identifier).replace('"', '""') + '"'


def _sql_string_literal(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _table_exists(cursor, table_name: str, vendor: str) -> bool:
    if vendor == "postgresql":
        cursor.execute(
            """
            select 1
            from information_schema.tables
            where table_schema = 'public' and table_name = %s
            """,
            [table_name],
        )
        return cursor.fetchone() is not None
    if vendor == "sqlite":
        cursor.execute(
            """
            select 1
            from sqlite_master
            where type = 'table' and name = %s
            """,
            [table_name],
        )
        return cursor.fetchone() is not None
    return False


def _column_exists(cursor, table_name: str, column_name: str) -> bool:
    cursor.execute(
        """
        select 1
        from information_schema.columns
        where table_schema = 'public' and table_name = %s and column_name = %s
        """,
        [table_name, column_name],
    )
    return cursor.fetchone() is not None


def _type_exists(cursor, type_name: str) -> bool:
    cursor.execute(
        """
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typname = %s
        """,
        [type_name],
    )
    return cursor.fetchone() is not None


def _drop_constraint(cursor, table_name: str, constraint_name: str) -> None:
    cursor.execute(
        f"alter table {_quote(table_name)} drop constraint if exists {_quote(constraint_name)}"
    )


def _drop_column(cursor, table_name: str, column_name: str) -> None:
    if _table_exists(cursor, table_name, "postgresql") and _column_exists(cursor, table_name, column_name):
        cursor.execute(
            f"alter table {_quote(table_name)} drop column {_quote(column_name)}"
        )


def _drop_table(cursor, table_name: str, vendor: str) -> None:
    if _table_exists(cursor, table_name, vendor):
        cursor.execute(f"drop table {_quote(table_name)}")


def _set_default(cursor, table_name: str, column_name: str, default_value: str) -> None:
    if _table_exists(cursor, table_name, "postgresql") and _column_exists(cursor, table_name, column_name):
        cursor.execute(
            f"""
            alter table {_quote(table_name)}
            alter column {_quote(column_name)} set default {_sql_string_literal(default_value)}
            """
        )


def cleanup_legacy_prisma_leftovers(apps, schema_editor) -> None:
    connection = schema_editor.connection
    vendor = connection.vendor

    legacy_tables = [
        "AuditLog",
        "DriverVehicle",
        "SpareStockTransaction",
        "OrderLogistics",
        "ProductCategory",
        "Role",
        "Driver",
        "_prisma_migrations",
    ]

    if vendor == "sqlite":
        with connection.cursor() as cursor:
            for table_name in legacy_tables:
                _drop_table(cursor, table_name, vendor)
        return

    if vendor != "postgresql":
        return

    with connection.cursor() as cursor:
        if (
            _table_exists(cursor, "User", vendor)
            and _table_exists(cursor, "Role", vendor)
            and _column_exists(cursor, "User", "role")
            and _column_exists(cursor, "User", "roleId")
        ):
            cursor.execute(
                """
                update "User" as u
                set role = r.name
                from "Role" as r
                where u."roleId" = r.id and (u.role is null or btrim(u.role) = '')
                """
            )

        if _table_exists(cursor, "User", vendor) and _table_exists(cursor, "Driver", vendor):
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

        if _table_exists(cursor, "Order", vendor) and _table_exists(cursor, "OrderLogistics", vendor):
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

        _set_default(cursor, "Order", "status", "PENDING")
        _set_default(cursor, "Replacement", "status", "REPORTED")
        _set_default(cursor, "Trip", "status", "PLANNED")
        _set_default(cursor, "TripDropPoint", "drop_point_type", "DELIVERY")
        _set_default(cursor, "TripDropPoint", "status", "PENDING")
        _set_default(cursor, "Vehicle", "status", "AVAILABLE")

        _drop_constraint(cursor, "User", "User_roleId_fkey")
        _drop_constraint(cursor, "Product", "Product_categoryId_fkey")

        legacy_columns = {
            "User": [
                "roleId",
            ],
            "Feedback": [
                "status",
                "response",
                "respondedAt",
                "respondedBy",
            ],
            "Inventory": [
                "maxStock",
                "reorderPoint",
            ],
            "LocationLog": [
                "speed",
            ],
            "Order": [
                "paymentMethod",
            ],
            "Product": [
                "description",
                "categoryId",
                "dimensions",
            ],
            "Replacement": [
                "pickupLatitude",
                "pickupLongitude",
                "pickupScheduled",
                "refundAmount",
                "refundStatus",
            ],
            "Trip": [
                "startLocation",
                "endLocation",
                "endLatitude",
                "endLongitude",
                "totalDistance",
                "estimatedTime",
                "actualTime",
                "plannedEndAt",
            ],
            "TripDropPoint": [
                "plannedArrival",
                "plannedDeparture",
                "recipientSignature",
            ],
            "Vehicle": [
                "make",
                "model",
                "year",
                "color",
                "volume",
                "fuelType",
                "mileage",
                "lastMaintenance",
                "nextMaintenance",
            ],
        }

        for table_name, columns in legacy_columns.items():
            for column_name in columns:
                _drop_column(cursor, table_name, column_name)

        for table_name in legacy_tables:
            _drop_table(cursor, table_name, vendor)

        legacy_enum_types = [
            "DropPointStatus",
            "DropPointType",
            "FeedbackStatus",
            "FeedbackType",
            "OrderStatus",
            "ReturnStatus",
            "RoleType",
            "TripStatus",
            "VehicleStatus",
            "VehicleType",
        ]
        for type_name in legacy_enum_types:
            if _type_exists(cursor, type_name):
                cursor.execute(f"drop type {_quote(type_name)}")


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0067_retarget_driver_foreign_keys_to_user"),
    ]

    operations = [
        migrations.RunPython(cleanup_legacy_prisma_leftovers, migrations.RunPython.noop),
    ]
