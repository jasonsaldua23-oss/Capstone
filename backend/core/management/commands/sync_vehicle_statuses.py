"""One-off reconciliation of vehicle AVAILABLE/IN_USE flags against in-progress trips.

Trips started before the fleet-sync rule existed left their trucks reading
AVAILABLE. Run this once after deploying; the trip endpoints keep it in sync
from then on. MAINTENANCE and OUT_OF_SERVICE vehicles are never touched.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from core.fleet_sync import sync_vehicle_status
from core.models import Vehicle


class Command(BaseCommand):
    help = "Reconcile every vehicle's AVAILABLE/IN_USE status with its IN_PROGRESS trips."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report the vehicles that would change without saving anything.",
        )

    def handle(self, *args, **options):
        dry_run = bool(options.get("dry_run"))
        changed = 0
        with transaction.atomic():
            for vehicle in Vehicle.objects.order_by("license_plate"):
                before = str(vehicle.status or "").strip().upper()
                after = sync_vehicle_status(vehicle)
                if after == before:
                    continue
                changed += 1
                self.stdout.write(f"{vehicle.license_plate}: {before} -> {after}")
            if dry_run:
                transaction.set_rollback(True)
        suffix = " (dry run, nothing saved)" if dry_run else ""
        self.stdout.write(self.style.SUCCESS(f"{changed} vehicle(s) updated{suffix}"))
