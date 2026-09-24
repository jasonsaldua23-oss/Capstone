import json
from importlib import import_module
from datetime import timedelta
from unittest.mock import patch

from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import TestCase, RequestFactory, SimpleTestCase, TransactionTestCase, override_settings
from django.utils import timezone

from .auth import create_token, extract_token
from .models import User, Warehouse, Vehicle, Order, Trip, Product, Inventory, StockBatch, Customer
from .views_api import drivers_collection, _driver_service_area_error, trips_collection, trip_detail, auth_register, auth_me, products_collection, _issue_email_verification_token, customer_orders, order_status_update, customer_order_cancel


class DriverServiceAreaTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create(email='area-admin@example.test', name='Admin', role='ADMIN')
        self.driver = User.objects.create(email='area-driver@example.test', name='Driver', role='DRIVER')

    def assign(self, actor, areas):
        request = RequestFactory().put('/api/drivers', data=json.dumps({'id': self.driver.id, 'serviceAreas': areas}), content_type='application/json')
        with patch('core.views_api._require_staff', return_value=({'userId': actor.id, 'role': actor.role}, None)):
            response = drivers_collection(request)
        self.driver.refresh_from_db()
        return response

    def test_admin_assignment_is_normalized_audited_and_checks_every_city(self):
        self.assertEqual(self.assign(self.admin, ['City A', ' city   a ']).status_code, 200)
        area = self.driver.service_areas[0]
        self.assertEqual((area["city"], area["assigned_by"]), ('city a', self.admin.id))
        self.assertIsNotNone(area["assigned_at"])
        self.assertIsNone(_driver_service_area_error(self.driver, ['CITY A']))
        self.assertIsNotNone(_driver_service_area_error(self.driver, ['City A', 'City B']))
        self.assertEqual(self.assign(self.admin, ['City A', 'City B']).status_code, 200)
        self.assertIsNone(_driver_service_area_error(self.driver, ['City A', 'City B']))

    def test_warehouse_cannot_grant_itself_areas(self):
        warehouse = User.objects.create(email='area-warehouse@example.test', name='Warehouse', role='WAREHOUSE_STAFF')
        self.assertEqual(self.assign(warehouse, ['City A']).status_code, 403)
        self.assertFalse(self.driver.service_areas)

    def test_retained_city_keeps_audit_details_and_assignment_can_be_cleared(self):
        self.assign(self.admin, ['City A'])
        original = self.driver.service_areas[0].copy()
        self.assign(self.admin, ['City A', 'City B'])
        self.assertEqual(self.driver.service_areas[0], original)
        self.assign(self.admin, [])
        self.assertEqual(self.driver.service_areas, [])
        self.assertIsNotNone(_driver_service_area_error(self.driver, ['City A']))

    def test_unassigned_and_on_leave_drivers_are_ineligible(self):
        self.assertIsNotNone(_driver_service_area_error(self.driver, ['City A']))
        self.assign(self.admin, ['City A'])
        self.driver.driver_status = 'ON_LEAVE'
        self.assertIsNotNone(_driver_service_area_error(self.driver, ['City A']))

    def test_trip_endpoint_rejects_unassigned_destination_without_creating_trip(self):
        warehouse = Warehouse.objects.create(name='Area Warehouse', code='AREA-TEST', address='Warehouse', city='City A', province='Province', zip_code='0000')
        vehicle = Vehicle.objects.create(license_plate='AREA-TEST', driver=self.driver, capacity=1000)
        order = Order.objects.create(order_number='AREA-ORDER', warehouse_id=warehouse.id, shipping_name='Receiver', shipping_address='Address', shipping_city='City B', shipping_province='Province', shipping_zip_code='0000', subtotal=0, total_amount=0)
        operator = User.objects.create(email='trip-operator@example.test', name='Operator', role='WAREHOUSE_STAFF')
        request = RequestFactory().post('/api/trips', data=json.dumps({'driverId': self.driver.id, 'vehicleId': vehicle.id, 'warehouseId': warehouse.id, 'orderIds': [order.id]}), content_type='application/json')
        self.assign(self.admin, ['City A'])
        with patch('core.views_api._require_staff', return_value=({'userId': operator.id, 'role': operator.role}, None)), patch('core.views_api._get_allowed_warehouse_ids_for_staff', return_value=[warehouse.id]), patch('core.views_api._missing_driver_profile_fields', return_value=[]), patch('core.views_api.driver_vehicle_license_error', return_value=None):
            response = trips_collection(request)
        self.assertEqual(response.status_code, 400)
        self.assertIn('not assigned', json.loads(response.content)['error'])
        self.assertFalse(Trip.objects.exists())

    def test_admin_cannot_edit_trip_operations(self):
        request = RequestFactory().patch('/api/trips/not-needed', data='{}', content_type='application/json')
        with patch('core.views_api._require_staff', return_value=({'userId': self.admin.id, 'role': self.admin.role}, None)):
            response = trip_detail(request, 'not-needed')
        self.assertEqual(response.status_code, 403)


class ServiceAreaMigrationTests(TransactionTestCase):
    @override_settings(MIGRATION_MODULES={})
    def test_multiple_assignments_and_audit_details_survive_round_trip(self):
        # Exercise the real schema/data operations against the isolated test database.
        loader = MigrationLoader(None)
        redundant_fields_before = loader.project_state([('core', '0133_remove_unused_transaction_fields')])
        redundant_fields_migration = import_module('core.migrations.0134_remove_redundant_cross_table_fields').Migration(
            '0134_remove_redundant_cross_table_fields', 'core'
        )
        with connection.schema_editor() as editor:
            redundant_fields_migration.unapply(redundant_fields_before, editor)

        def restore_current_redundant_fields_schema():
            with connection.schema_editor() as editor:
                redundant_fields_migration.apply(redundant_fields_before.clone(), editor)
            if connection.vendor == 'sqlite':
                # SQLite rebuilds the entire historical Customer table while applying
                # 0134, which also restores approval columns removed later by 0139.
                # Reapply that later removal so following CI tests see today's schema.
                approval_before = loader.project_state([('core', '0138_rename_preparing_order_label')])
                approval_migration = import_module(
                    'core.migrations.0139_remove_customer_registration_approval'
                ).Migration('0139_remove_customer_registration_approval', 'core')
                with connection.schema_editor() as editor:
                    approval_migration.apply(approval_before, editor)

        self.addCleanup(restore_current_redundant_fields_schema)
        license_photo_before = loader.project_state([('core', '0131_remove_user_driver_profile_fields')])
        license_photo_migration = import_module('core.migrations.0132_remove_user_license_photo_url').Migration(
            '0132_remove_user_license_photo_url', 'core'
        )
        with connection.schema_editor() as editor:
            license_photo_migration.unapply(license_photo_before, editor)

        def restore_current_license_photo_schema():
            with connection.schema_editor() as editor:
                license_photo_migration.apply(license_photo_before.clone(), editor)

        self.addCleanup(restore_current_license_photo_schema)
        user_fields_before = loader.project_state([('core', '0130_separate_transaction_documents')])
        user_fields_migration = import_module('core.migrations.0131_remove_user_driver_profile_fields').Migration(
            '0131_remove_user_driver_profile_fields', 'core'
        )
        # Restore the three older User columns while this test exercises migration 0128.
        with connection.schema_editor() as editor:
            user_fields_migration.unapply(user_fields_before, editor)

        def restore_current_user_schema():
            with connection.schema_editor() as editor:
                user_fields_migration.apply(user_fields_before.clone(), editor)

        self.addCleanup(restore_current_user_schema)
        before = loader.project_state([('core', '0127_remove_unused_return_receipts')])
        migration = import_module('core.migrations.0128_move_service_areas_to_user').Migration(
            '0128_move_service_areas_to_user', 'core'
        )
        with connection.schema_editor() as editor:
            migration.unapply(before, editor)
        try:
            OldUser = before.apps.get_model('core', 'User')
            OldArea = before.apps.get_model('core', 'DriverServiceArea')
            driver = OldUser.objects.create(email='migration@example.test', name='Driver', role='DRIVER')
            unassigned = OldUser.objects.create(email='unassigned@example.test', name='Staff')
            assigned_at = timezone.now() - timedelta(days=10)
            for city in ['silay', 'talisay']:
                OldArea.objects.create(driver=driver, city=city, assigned_by='original-admin', assigned_at=assigned_at)
        finally:
            with connection.schema_editor() as editor:
                migration.apply(before.clone(), editor)
        expected = [
            {'city': city, 'assigned_by': 'original-admin', 'assigned_at': assigned_at.isoformat()}
            for city in ['silay', 'talisay']
        ]
        self.assertEqual(User.objects.get(pk=driver.pk).service_areas, expected)
        self.assertEqual(User.objects.get(pk=unassigned.pk).service_areas, [])
        self.assertNotIn('core_driverservicearea', connection.introspection.table_names())
        with connection.schema_editor() as editor:
            migration.unapply(before, editor)
        try:
            restored = list(OldArea.objects.filter(driver_id=driver.pk).order_by('city'))
            self.assertEqual([area.city for area in restored], ['silay', 'talisay'])
            self.assertTrue(all(area.assigned_by == 'original-admin' and area.assigned_at == assigned_at for area in restored))
        finally:
            with connection.schema_editor() as editor:
                migration.apply(before.clone(), editor)


class PortalCookieTests(SimpleTestCase):
    def test_remembered_staff_portal_does_not_select_customer_cookie(self):
        request = RequestFactory().get('/api/auth/me', HTTP_X_PORTAL='warehouse')
        staff = create_token({'type': 'staff', 'role': 'WAREHOUSE_STAFF'})
        customer = create_token({'type': 'customer'})
        request.COOKIES = {'auth_token_customer': customer, 'auth_token_staff': staff}
        self.assertEqual(extract_token(request), staff)
        request = RequestFactory().get('/api/auth/me', HTTP_X_PORTAL='warehouse', HTTP_AUTHORIZATION=f'Bearer {customer}')
        request.COOKIES = {'auth_token_customer': customer, 'auth_token_staff': staff}
        # An explicit tab credential always takes priority over the cookie hint.
        self.assertEqual(extract_token(request), customer)


class NewCustomerAccessTests(TestCase):
    def test_registration_immediately_restores_customer_and_available_products(self):
        warehouse = Warehouse.objects.create(name='Central Depot', code='CENTRAL', address='Depot', city='City', province='Province', zip_code='0000')
        product = Product.objects.create(name='Beverage', sku='BEVERAGE', category='Sport Drinks', quantity_per_unit=24, price=240)
        inventory = Inventory.objects.create(warehouse=warehouse, product=product, quantity=12, reserved_quantity=2)
        # Availability is batch-backed for FEFO allocation, including first login.
        StockBatch.objects.create(batch_number='REGISTRATION-BATCH', inventory=inventory, quantity=12, receipt_date=timezone.now(), expiry_date=timezone.now() + timedelta(days=30))
        email = 'registration.regression@gmail.com'
        # Use the real verified-email token format without sending external email.
        request = RequestFactory().post('/api/auth/register', data=json.dumps({
            'firstName': 'New', 'lastName': 'Customer', 'email': email,
            'password': 'Regression2026!Aa',
            'emailVerificationToken': _issue_email_verification_token(email, 'customer'),
        }), content_type='application/json')
        response = auth_register(request)
        self.assertEqual(response.status_code, 201, response.content)
        # Customer registration now creates a usable session immediately after email verification.
        self.assertIn('token', json.loads(response.content))
        customer = Customer.objects.get(email=email)
        token = create_token({'userId': customer.id, 'email': customer.email, 'name': customer.name, 'type': 'customer'})
        authenticated = RequestFactory().get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        me = auth_me(authenticated)
        self.assertEqual(json.loads(me.content)['user']['type'], 'customer')
        catalog_request = RequestFactory().get('/api/products', HTTP_AUTHORIZATION=f'Bearer {token}')
        # Repeating the read covers both a fresh login and the same account after restore.
        for _ in range(2):
            catalog = products_collection(catalog_request)
            self.assertEqual(catalog.status_code, 200)
            row = next(row for row in json.loads(catalog.content)['products'] if row['id'] == product.id)
            # Available stock excludes the two cases held by the legacy reservation counter.
            self.assertEqual(row['availableQuantity'], 10)
        inventory = Inventory.objects.get(product=product)
        checkout = RequestFactory().post('/api/customer/orders', HTTP_AUTHORIZATION=f'Bearer {token}', data=json.dumps({
            'warehouseId': warehouse.id, 'items': [{'productId': product.id, 'quantity': 1}],
            'shippingName': 'New Customer', 'shippingAddress': 'Delivery address',
            'shippingCity': 'Silay', 'shippingProvince': 'Negros Occidental',
            'shippingLatitude': 10.8, 'shippingLongitude': 122.97,
        }), content_type='application/json')
        with patch('core.views_api._email_new_order_to_warehouse_staff'), patch('core.views_api._email_purchase_request_submitted_to_customer'), patch('core.views_api._create_staff_notifications'):
            created = customer_orders(checkout)
        self.assertEqual(created.status_code, 201, created.content)
        order = Order.objects.get(customer_id=customer.id)
        self.assertEqual(order.request_status, 'PENDING_APPROVAL')
        original_pr = order.purchase_request_number
        operator = User.objects.create(name='Operator', email='operator@capstone.local', role='WAREHOUSE_STAFF')
        approval = RequestFactory().patch('/api/orders/status', data=json.dumps({'status': 'APPROVED'}), content_type='application/json')
        with patch('core.views_api._require_staff', return_value=({'role': operator.role, 'userId': operator.id, 'name': operator.name}, None)), patch('core.views_api._email_purchase_request_approved_to_customer'), patch('core.views_api._create_staff_notifications'):
            approved = order_status_update(approval, order.id)
        self.assertEqual(approved.status_code, 200, approved.content)
        order.refresh_from_db()
        self.assertTrue(order.purchase_order_number)
        self.assertEqual(order.purchase_request_number, original_pr)
        cancel = RequestFactory().patch('/api/customer/orders/cancel', HTTP_AUTHORIZATION=f'Bearer {token}', data=json.dumps({'reason': 'Customer changed delivery plans'}), content_type='application/json')
        with patch('core.views_api._email_order_cancelled_to_customer'):
            cancelled = customer_order_cancel(cancel, order.id)
        self.assertEqual(cancelled.status_code, 200, cancelled.content)
        inventory.refresh_from_db()
        self.assertEqual(inventory.reserved_quantity, 2)
