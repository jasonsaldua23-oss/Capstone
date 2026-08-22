from django.core.management.base import BaseCommand
from django.db import transaction
from core.models import (
    User, Customer, Order, OrderItem, OrderTimeline,
    Trip, TripDropPoint, Replacement, ReplacementLine,
    Feedback, Notification, LocationLog, InventoryReservation
)


class Command(BaseCommand):
    help = 'Clear demo seed data (orders, trips, feedback, @example.com users/customers)'

    def handle(self, *args, **options):
        demo_customers = Customer.objects.filter(email__icontains='@example.com')
        demo_customer_ids = list(demo_customers.values_list('id', flat=True))

        demo_users = User.objects.filter(email__icontains='@example.com')
        demo_user_ids = list(demo_users.values_list('id', flat=True))

        self.stdout.write(f"Targeting {len(demo_customer_ids)} demo customers and {len(demo_user_ids)} demo users.")

        with transaction.atomic():
            # 1. Replacements
            rep_count, _ = Replacement.objects.filter(order__customer_id__in=demo_customer_ids).delete()
            self.stdout.write(f"  [OK] Deleted replacements: {rep_count}")

            # 2. Feedback
            fb_count, _ = Feedback.objects.filter(customer_id__in=demo_customer_ids).delete()
            self.stdout.write(f"  [OK] Deleted feedback: {fb_count}")

            # 3. Trips for demo drivers or demo orders
            trip_count, _ = Trip.objects.filter(driver_id__in=demo_user_ids).delete()
            self.stdout.write(f"  [OK] Deleted demo driver trips: {trip_count}")

            # 4. Orders for demo customers
            order_count, _ = Order.objects.filter(customer_id__in=demo_customer_ids).delete()
            self.stdout.write(f"  [OK] Deleted demo customer orders: {order_count}")

            # 5. Dangling trips
            dangling_trips, _ = Trip.objects.filter(drop_points__isnull=True).delete()
            self.stdout.write(f"  [OK] Deleted dangling trips: {dangling_trips}")

            # 6. Demo customers
            cust_count, _ = demo_customers.delete()
            self.stdout.write(f"  [OK] Deleted demo customers: {cust_count}")

            # 7. Demo users
            user_count, _ = demo_users.delete()
            self.stdout.write(f"  [OK] Deleted demo users: {user_count}")

            # 8. Notifications
            notif_count, _ = Notification.objects.filter(user_id__in=demo_user_ids).delete()
            self.stdout.write(f"  [OK] Deleted demo notifications: {notif_count}")

            # 9. Location logs
            loc_count, _ = LocationLog.objects.filter(driver_id__in=demo_user_ids).delete()
            self.stdout.write(f"  [OK] Deleted demo location logs: {loc_count}")

        self.stdout.write(self.style.SUCCESS("All demo seed data has been removed successfully!"))
