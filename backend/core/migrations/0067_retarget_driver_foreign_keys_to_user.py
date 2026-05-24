from django.db import migrations


def retarget_driver_foreign_keys_to_user(apps, schema_editor) -> None:
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return

    with connection.cursor() as cursor:
        cursor.execute(
            """
            select exists (
                select 1
                from information_schema.tables
                where table_schema = 'public' and table_name = 'Driver'
            )
            """
        )
        driver_table_exists = bool(cursor.fetchone()[0])

        cursor.execute(
            """
            alter table "Trip" drop constraint if exists "Trip_driverId_fkey"
            """
        )
        cursor.execute(
            """
            alter table "LocationLog" drop constraint if exists "LocationLog_driverId_fkey"
            """
        )

        if driver_table_exists:
            cursor.execute(
                """
                update "Trip" as t
                set driver_id = d."userId"
                from "Driver" as d
                where t.driver_id = d.id
                """
            )
            cursor.execute(
                """
                update "LocationLog" as l
                set driver_id = d."userId"
                from "Driver" as d
                where l.driver_id = d.id
                """
            )

        cursor.execute(
            """
            alter table "Trip"
            add constraint "Trip_driverId_fkey"
            foreign key (driver_id) references "User"(id)
            on update cascade on delete cascade
            deferrable initially deferred
            """
        )
        cursor.execute(
            """
            alter table "LocationLog"
            add constraint "LocationLog_driverId_fkey"
            foreign key (driver_id) references "User"(id)
            on update cascade on delete cascade
            deferrable initially deferred
            """
        )
        cursor.execute(
            """
            alter table "Vehicle" drop constraint if exists "Vehicle_driver_id_user_fk"
            """
        )
        cursor.execute(
            """
            alter table "Vehicle"
            add constraint "Vehicle_driver_id_user_fk"
            foreign key (driver_id) references "User"(id)
            on update cascade on delete set null
            deferrable initially deferred
            """
        )
        cursor.execute(
            """
            alter table "InventoryTransaction" drop constraint if exists "InventoryTransaction_driver_id_user_fk"
            """
        )
        cursor.execute(
            """
            alter table "InventoryTransaction"
            add constraint "InventoryTransaction_driver_id_user_fk"
            foreign key (driver_id) references "User"(id)
            on update cascade on delete cascade
            deferrable initially deferred
            """
        )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0066_relax_legacy_user_roleid"),
    ]

    operations = [
        migrations.RunPython(retarget_driver_foreign_keys_to_user, migrations.RunPython.noop),
    ]
