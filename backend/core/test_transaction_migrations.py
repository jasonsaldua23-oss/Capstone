"""Exercise the data move, including balance preservation, on an isolated schema."""

from decimal import Decimal
from importlib import import_module

from django.db import DatabaseError, connection, transaction
from django.db.migrations.loader import MigrationLoader
from django.test import TransactionTestCase, override_settings

from .models import Order, OrderCharge, PurchaseOrder, PurchaseRequest, Replacement, RetailSale


class TransactionDocumentMigrationTests(TransactionTestCase):
    @override_settings(MIGRATION_MODULES={})
    def test_existing_transactions_keep_ids_documents_charges_and_retail_details(self):
        loader = MigrationLoader(None)
        later_migrations = [
            ('0131_remove_user_driver_profile_fields', '0130_separate_transaction_documents'),
            ('0132_remove_user_license_photo_url', '0131_remove_user_driver_profile_fields'),
            ('0133_remove_unused_transaction_fields', '0132_remove_user_license_photo_url'),
            ('0134_remove_redundant_cross_table_fields', '0133_remove_unused_transaction_fields'),
            ('0135_remove_legacy_packaging_profiles', '0134_remove_redundant_cross_table_fields'),
        ]
        migration_steps = [
            (
                import_module(f'core.migrations.{name}').Migration(name, 'core'),
                loader.project_state([('core', previous)]),
            )
            for name, previous in later_migrations
        ]
        # Put the isolated database at migration 0130 before round-tripping the
        # older document split, then restore today's schema after the assertions.
        for migration, before_state in reversed(migration_steps):
            with connection.schema_editor() as editor:
                migration.unapply(before_state, editor)

        def restore_current_schema():
            for migration, before_state in migration_steps:
                with connection.schema_editor() as editor:
                    migration.apply(before_state.clone(), editor)

        self.addCleanup(restore_current_schema)
        state = loader.project_state([('core', '0128_move_service_areas_to_user')])
        fields_migration = import_module('core.migrations.0129_remove_unused_order_fields').Migration('0129', 'core')
        split_migration = import_module('core.migrations.0130_separate_transaction_documents').Migration('0130', 'core')
        after_fields = loader.project_state([('core', '0129_remove_unused_order_fields')])
        with connection.schema_editor() as editor:
            split_migration.unapply(after_fields, editor)
        # Test setup only: rebuild the old empty schema. Production reversal intentionally
        # requires a backup because tendered cash and the removed workflow were retired.
        fields_migration.operations[1].reverse_code = lambda apps, editor: None
        with connection.schema_editor() as editor:
            fields_migration.unapply(state, editor)
        try:
            OldOrder = state.apps.get_model('core', 'Order')
            OldItem = state.apps.get_model('core', 'OrderItem')
            common = {'subtotal': 100, 'total_amount': 100}
            pending = OldOrder.objects.create(order_number='PR-OLD-1', purchase_request_number='PR-OLD-1', **common)
            approved = OldOrder.objects.create(
                order_number='PO-OLD-1', purchase_request_number='PR-OLD-2', purchase_order_number='PO-OLD-1',
                request_status='APPROVED', status='CANCELLED', cancellation_reason='PO cancellation',
                remaining_balance=Decimal('10'), **common,
            )
            item = OldItem.objects.create(order=approved, product_name='Original product', quantity=2, unit_price=50, total_price=100)
            retail = OldOrder.objects.create(
                order_number='POS-OLD-1', sales_channel='RETAIL_POS', retail_transaction_number='POS-OLD-1',
                retail_request_id='retail-retry', walk_in_name='Original walk-in', retail_status='COMPLETED',
                amount_paid=20, remaining_balance=80, **common,
            )
            replacement = OldOrder.objects.create(order_number='RPL-OLD-1', **common)
            OldReplacement = state.apps.get_model('core', 'Replacement')
            owner = OldReplacement.objects.create(
                replacement_number='REP-OLD-1', order=approved, customer_id='legacy-customer',
                reason='Damaged item', pickup_address='Address', pickup_city='City',
                pickup_province='Province', pickup_zip_code='0000',
                notes='Meta: {"replacementOrderId": "' + replacement.pk + '"}',
            )
        finally:
            with connection.schema_editor() as editor:
                next_state = fields_migration.apply(state.clone(), editor)
                split_migration.apply(next_state, editor)

        self.assertEqual(Order.objects.count(), 4)
        self.assertEqual(Order._meta.db_table, 'Transaction')
        self.assertNotIn('Order', connection.introspection.table_names())
        sale = RetailSale.objects.get(order_id=retail.pk)
        self.assertEqual((sale.walk_in_name, sale.retail_request_id), ('Original walk-in', 'retail-retry'))
        self.assertEqual(PurchaseRequest.objects.count(), 2)
        self.assertEqual(PurchaseRequest.objects.get(transaction_id=pending.pk).status, 'PENDING_APPROVAL')
        po = PurchaseOrder.objects.select_related('purchase_request').get(transaction_id=approved.pk)
        self.assertEqual(po.purchase_request.number, 'PR-OLD-2')
        self.assertIsNotNone(po.purchase_request.locked_at)
        self.assertIsNone(po.purchase_request.snapshot['cancellation_reason'])
        self.assertEqual(po.purchase_request.snapshot['items'][0]['id'], item.pk)
        self.assertEqual(Replacement.objects.get(pk=owner.pk).delivery_transaction_id, replacement.pk)
        self.assertNotIn('ReplacementDelivery', connection.introspection.table_names())
        self.assertEqual(OrderCharge.objects.get(order_id=approved.pk).amount, Decimal('10'))
        self.assertEqual(OrderCharge.objects.get(order_id=retail.pk).amount, Decimal('80'))
        retired = {'tax', 'amount_paid', 'remaining_balance', 'fulfillment_type', 'pickup_status', 'walk_in_name'}
        self.assertFalse(retired & {field.name for field in Order._meta.fields})
        # The migration's database trigger also rejects writes bypassing Model.save().
        with self.assertRaises(DatabaseError), transaction.atomic():
            PurchaseRequest.objects.filter(pk=po.purchase_request_id).update(status='CANCELLED')
