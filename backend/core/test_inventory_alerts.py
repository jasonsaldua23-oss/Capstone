from unittest.mock import patch

from django.test import TestCase

from .models import Inventory, Notification, Product, RoleType, User, Warehouse


class InventoryStockAlertTests(TestCase):
    def setUp(self) -> None:
        self.admin = User.objects.create(
            email="inventory.admin@example.test",
            password="hashed",
            name="Inventory Admin",
            role=RoleType.ADMIN,
            is_active=True,
        )
        self.warehouse_staff = User.objects.create(
            email="inventory.warehouse@example.test",
            password="hashed",
            name="Warehouse Staff",
            role=RoleType.WAREHOUSE_STAFF,
            is_active=True,
        )
        self.warehouse = Warehouse.objects.create(
            name="Alert Warehouse",
            code="ALERT-WH",
            address="Test Street",
            city="Bacolod",
            province="Negros Occidental",
            zip_code="6100",
        )
        self.product = Product.objects.create(
            sku="ALERT-SKU",
            name="Alert Product",
            unit="case",
            quantity_per_unit=24,
        )
        self.inventory = Inventory.objects.create(
            warehouse=self.warehouse,
            product=self.product,
            quantity=15,
            threshold=10,
        )

    @patch("core.views_api._send_structured_email")
    @patch("core.views_api.queue_web_push")
    def test_reorder_and_out_of_stock_transitions_notify_admin_and_warehouse_staff(
        self,
        mocked_push,
        mocked_email,
    ) -> None:
        # Crossing the reorder point creates one alert per eligible staff account.
        with self.captureOnCommitCallbacks(execute=True):
            self.inventory.quantity = 10
            self.inventory.save(update_fields=["quantity", "updated_at"])

        restock_notifications = Notification.objects.filter(title="Restock needed: Alert Product")
        self.assertEqual(restock_notifications.count(), 2)
        self.assertSetEqual(
            set(restock_notifications.values_list("user_id", flat=True)),
            {self.admin.id, self.warehouse_staff.id},
        )
        mocked_push.assert_called_once()
        self.assertSetEqual(
            set(mocked_push.call_args.kwargs["user_ids"]),
            {self.admin.id, self.warehouse_staff.id},
        )
        self.assertSetEqual(
            set(mocked_email.call_args.kwargs["recipients"]),
            {self.admin.email, self.warehouse_staff.email},
        )

        mocked_push.reset_mock()
        mocked_email.reset_mock()

        # Reaching zero is a separate high-priority transition, not a repeated low-stock alert.
        with self.captureOnCommitCallbacks(execute=True):
            self.inventory.quantity = 0
            self.inventory.save(update_fields=["quantity", "updated_at"])

        out_notifications = Notification.objects.filter(title="Out of stock: Alert Product")
        self.assertEqual(out_notifications.count(), 2)
        mocked_push.assert_called_once()
        mocked_email.assert_called_once()

    @patch("core.views_api._send_structured_email")
    @patch("core.views_api.queue_web_push")
    def test_saves_within_the_same_stock_stage_do_not_repeat_alerts(self, mocked_push, mocked_email) -> None:
        with self.captureOnCommitCallbacks(execute=True):
            self.inventory.quantity = 10
            self.inventory.save(update_fields=["quantity", "updated_at"])

        mocked_push.reset_mock()
        mocked_email.reset_mock()
        with self.captureOnCommitCallbacks(execute=True):
            self.inventory.quantity = 9
            self.inventory.save(update_fields=["quantity", "updated_at"])

        self.assertEqual(Notification.objects.filter(title="Restock needed: Alert Product").count(), 2)
        mocked_push.assert_not_called()
        mocked_email.assert_not_called()
