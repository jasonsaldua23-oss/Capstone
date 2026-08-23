"""
Django management command to clear Order and Trip data.
"""
from django.core.management.base import BaseCommand
from django.apps import apps


class Command(BaseCommand):
    help = 'Clear all Order and Trip data (preserves users, customers, products, etc.)'

    def handle(self, *args, **options):
        models_to_clear = [
            'core.TripDropPoint',
            'core.Trip',
            'core.OrderItem',
            'core.Order',
            'core.Replacement',
            'core.Notification',
        ]

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

        self.stdout.write(self.style.SUCCESS('\n[SUCCESS] Orders and Trips cleared successfully!'))
