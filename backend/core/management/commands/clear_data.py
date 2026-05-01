"""
Django management command to clear database content except users and customers
"""
from django.core.management.base import BaseCommand
from django.apps import apps
from django.db import connection


class Command(BaseCommand):
    help = 'Clear all database content except User and Customer tables'

    def handle(self, *args, **options):
        models_to_clear = [
            'core.Trip',
            'core.Order',
            'core.Replacement',
            'core.Notification',
            'core.InventoryTransaction',
            'core.StockBatch',
            'core.Inventory',
            'core.Product',
            'core.Vehicle',
            'core.Warehouse',
        ]

        # Disable foreign key constraints temporarily
        with connection.cursor() as cursor:
            # For SQLite, disable foreign key checks
            cursor.execute('PRAGMA foreign_keys = OFF;')

        try:
            for model_label in models_to_clear:
                try:
                    model = apps.get_model(model_label)
                    count = model.objects.count()
                    model.objects.all().delete()
                    self.stdout.write(f"[OK] Cleared {model.__name__} ({count} records deleted)")
                except LookupError as e:
                    self.stdout.write(self.style.WARNING(f"[SKIP] Model {model_label} not found: {e}"))
                except Exception as e:
                    self.stdout.write(self.style.ERROR(f"[ERROR] Error clearing {model_label}: {e}"))
        finally:
            # Re-enable foreign key constraints
            with connection.cursor() as cursor:
                cursor.execute('PRAGMA foreign_keys = ON;')

        self.stdout.write(self.style.SUCCESS('\n[SUCCESS] Database cleared successfully! User and Customer data preserved.'))
