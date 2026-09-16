"""Cross-device sync stamps: bumping, completeness, and the read endpoint."""

from datetime import timedelta

from django.test import Client, TestCase
from django.utils import timezone

from .auth import create_token
from .models import Inventory, Product, RoleType, SyncStamp, User, Warehouse
from .sync_stamps import (
    TRACKING_BUMP_INTERVAL_SECONDS,
    bump_scopes,
    bump_scopes_throttled,
    read_stamps,
    scopes_for_path,
    throttled_scopes_for_path,
)


class SyncStampBumpTests(TestCase):
    def test_model_write_bumps_only_its_own_scopes(self) -> None:
        before = read_stamps()

        with self.captureOnCommitCallbacks(execute=True):
            Product.objects.create(sku="SYNC-SKU", name="Sync Product", unit="case", quantity_per_unit=24)

        after = read_stamps()
        self.assertGreater(after["products"], before["products"])
        # A catalog write says nothing about trips, so trip screens must not reload.
        self.assertEqual(after["trips"], before["trips"])
        self.assertEqual(after["feedback"], before["feedback"])

    def test_stock_write_bumps_every_scope_that_describes_stock(self) -> None:
        before = read_stamps()

        with self.captureOnCommitCallbacks(execute=True):
            warehouse = Warehouse.objects.create(
                name="Sync Warehouse",
                code="SYNC-WH",
                address="Test Street",
                city="Bacolod",
                province="Negros Occidental",
                zip_code="6100",
            )
            product = Product.objects.create(sku="SYNC-STOCK", name="Stock Product", unit="case", quantity_per_unit=24)
            Inventory.objects.create(warehouse=warehouse, product=product, quantity=10, threshold=5)

        after = read_stamps()
        # The portals read stock through both scopes, so they have to move together.
        self.assertGreater(after["inventory"], before["inventory"])
        self.assertGreater(after["stocks"], before["stocks"])

    def test_bump_is_deferred_until_commit(self) -> None:
        """A revision published before its rows commit would strand every reader.

        The client would re-fetch on the new revision, read pre-commit data, and
        record that revision as seen - so the real change would never trigger
        another refresh.
        """
        before = read_stamps()

        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            bump_scopes(["orders"])
            self.assertEqual(read_stamps()["orders"], before["orders"])

        self.assertEqual(len(callbacks), 1)
        for callback in callbacks:
            callback()
        self.assertGreater(read_stamps()["orders"], before["orders"])

    def test_unknown_scopes_are_ignored(self) -> None:
        before = read_stamps()
        with self.captureOnCommitCallbacks(execute=True):
            bump_scopes(["not-a-scope", "orders"])
        after = read_stamps()
        self.assertGreater(after["orders"], before["orders"])
        self.assertFalse(SyncStamp.objects.filter(scope="not-a-scope").exists())

    def test_signing_in_does_not_make_every_device_reload(self) -> None:
        """Each login writes last_login_at. Treating that as a staff-list change
        would refresh every connected portal on every sign-in."""
        user = User.objects.create(
            email="sync.login@example.test",
            password="hashed",
            name="Sync Login",
            role=RoleType.ADMIN,
            is_active=True,
        )
        before = read_stamps()

        with self.captureOnCommitCallbacks(execute=True):
            user.last_login_at = timezone.now()
            user.save(update_fields=["last_login_at", "updated_at"])

        self.assertEqual(read_stamps()["drivers"], before["drivers"])

    def test_a_real_account_edit_still_bumps(self) -> None:
        user = User.objects.create(
            email="sync.edit@example.test",
            password="hashed",
            name="Sync Edit",
            role=RoleType.DRIVER,
            is_active=True,
        )
        before = read_stamps()

        with self.captureOnCommitCallbacks(execute=True):
            user.name = "Sync Edited"
            user.save(update_fields=["name", "updated_at"])

        self.assertGreater(read_stamps()["drivers"], before["drivers"])

    def test_high_frequency_driver_pings_do_not_bump_trips(self) -> None:
        """Location logs land every few seconds; treating them as trip changes
        would put every portal into a permanent reload loop."""
        self.assertEqual(scopes_for_path("/api/driver/location"), ())
        # They do carry the map's own scope, which is throttled instead.
        self.assertEqual(throttled_scopes_for_path("/api/driver/location"), ("tracking",))
        self.assertEqual(throttled_scopes_for_path("/api/trips"), ())

    def test_tracking_advances_once_per_window_however_many_pings_arrive(self) -> None:
        """Several drivers report every few seconds. The maps should learn that
        something moved, not be asked to re-read once per ping."""
        before = read_stamps()["tracking"]
        for _ in range(5):
            bump_scopes_throttled(["tracking"])
        first = read_stamps()["tracking"]
        self.assertEqual(first, before + 1, "a burst of pings is one bump")

        # Once the window has passed, the next ping moves it again.
        SyncStamp.objects.filter(scope="tracking").update(
            updated_at=timezone.now() - timedelta(seconds=TRACKING_BUMP_INTERVAL_SECONDS + 1)
        )
        bump_scopes_throttled(["tracking"])
        self.assertEqual(read_stamps()["tracking"], first + 1)

    def test_a_throttled_scope_missing_from_the_table_is_created(self) -> None:
        """A scope added after the last migration still has to work."""
        SyncStamp.objects.filter(scope="tracking").delete()
        bump_scopes_throttled(["tracking"])
        self.assertEqual(read_stamps()["tracking"], 1)

    def test_auth_writes_never_bump(self) -> None:
        self.assertEqual(scopes_for_path("/api/auth/login"), ())
        self.assertEqual(scopes_for_path("/api/sync/stamps"), ())

    def test_path_map_prefers_the_most_specific_prefix(self) -> None:
        self.assertEqual(scopes_for_path("/api/inventory-transactions"), ("inventory-transactions", "inventory", "stocks"))
        self.assertIn("stock-batches", scopes_for_path("/api/inventory"))


class SyncStampWritePathTests(TestCase):
    """The middleware exists to cover writes that never fire a model signal."""

    def setUp(self) -> None:
        self.admin = User.objects.create(
            email="sync.admin@example.test",
            password="hashed",
            name="Sync Admin",
            role=RoleType.ADMIN,
            is_active=True,
        )
        self.token = create_token({"type": "staff", "userId": self.admin.id, "role": RoleType.ADMIN})
        self.client = Client()

    def test_queryset_update_still_bumps_through_the_middleware(self) -> None:
        """`QuerySet.update()` fires no signal, so only the URL map can catch it."""
        response = self.client.patch(
            "/api/notifications",
            data={"markAll": True},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertEqual(response.status_code, 200)
        self.assertGreater(read_stamps()["notifications"], 0)

    def test_rejected_write_does_not_bump(self) -> None:
        before = read_stamps()
        response = self.client.patch(
            "/api/notifications",
            data={},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )
        self.assertGreaterEqual(response.status_code, 400)
        self.assertEqual(read_stamps(), before | {"notifications": before["notifications"]})

    def test_read_request_does_not_bump(self) -> None:
        before = read_stamps()
        response = self.client.get("/api/products", HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(read_stamps()["products"], before["products"])


class SyncStampEndpointTests(TestCase):
    def setUp(self) -> None:
        self.admin = User.objects.create(
            email="sync.endpoint@example.test",
            password="hashed",
            name="Sync Endpoint Admin",
            role=RoleType.ADMIN,
            is_active=True,
        )
        self.token = create_token({"type": "staff", "userId": self.admin.id, "role": RoleType.ADMIN})
        self.client = Client()

    def test_requires_authentication(self) -> None:
        self.assertEqual(self.client.get("/api/sync/stamps").status_code, 401)

    def test_returns_every_scope_and_is_never_cached(self) -> None:
        response = self.client.get("/api/sync/stamps", HTTP_AUTHORIZATION=f"Bearer {self.token}")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["success"])
        self.assertIn("orders", body["stamps"])
        self.assertIn("notifications", body["stamps"])
        self.assertIn("no-store", response["Cache-Control"])

    def test_revision_advances_so_other_devices_can_detect_the_change(self) -> None:
        first = self.client.get("/api/sync/stamps", HTTP_AUTHORIZATION=f"Bearer {self.token}").json()["stamps"]

        with self.captureOnCommitCallbacks(execute=True):
            Product.objects.create(sku="SYNC-ENDPOINT", name="Endpoint Product", unit="case", quantity_per_unit=12)

        second = self.client.get("/api/sync/stamps", HTTP_AUTHORIZATION=f"Bearer {self.token}").json()["stamps"]
        self.assertGreater(second["products"], first["products"])
        self.assertEqual(second["trips"], first["trips"])

    def test_reading_stamps_costs_a_single_query(self) -> None:
        """Every signed-in device polls this endpoint, so its cost is the design."""
        with self.assertNumQueries(1):
            read_stamps()
