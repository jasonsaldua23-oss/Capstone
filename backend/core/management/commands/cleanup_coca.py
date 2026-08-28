from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import (
    Product,
    OrderItem,
    Inventory,
    InventoryTransaction,
    MixedCaseComponent,
    Replacement,
    ReplacementLine,
)


class Command(BaseCommand):
    help = "Reassign Coca-Cola/Coke product references to a Pepsi product and remove Coca-Cola products"

    def handle(self, *args, **options):
        coca_qs = Product.objects.filter(name__iregex=r'(?i)coca|coke|coca[- ]?cola')
        if not coca_qs.exists():
            self.stdout.write(self.style.SUCCESS("No Coca-Cola/Coke products found."))
            return

        pepsi = Product.objects.filter(name__icontains="Pepsi").first()
        if not pepsi:
            pepsi = Product.objects.create(sku="PEPS-REPLACEMENT", name="Pepsi", price=0)
            self.stdout.write(self.style.WARNING(f"Created placeholder Pepsi product: {pepsi.sku}"))

        with transaction.atomic():
            count_products = coca_qs.count()
            self.stdout.write(f"Found {count_products} Coca-Cola/Coke product(s). Reassigning references to {pepsi.sku}...")

            # Order items
            oi_qs = OrderItem.objects.filter(product__in=coca_qs)
            oi_count = oi_qs.count()
            oi_qs.update(product=pepsi, product_name=pepsi.name, product_sku=pepsi.sku, unit_price=pepsi.price)

            # Inventory - merge when a Pepsi inventory already exists for the same warehouse
            inv_qs = Inventory.objects.filter(product__in=coca_qs)
            inv_count = inv_qs.count()
            inv_migrated = 0
            inv_merged = 0
            for inv in inv_qs.select_related("warehouse"):
                try:
                    existing = Inventory.objects.get(warehouse=inv.warehouse, product=pepsi)
                    # Merge numeric fields
                    existing.quantity = (existing.quantity or 0) + (inv.quantity or 0)
                    existing.loose_bottles = (existing.loose_bottles or 0) + (inv.loose_bottles or 0)
                    existing.reserved_quantity = (existing.reserved_quantity or 0) + (inv.reserved_quantity or 0)
                    existing.reserved_base_units = (existing.reserved_base_units or 0) + (inv.reserved_base_units or 0)
                    # Keep the most recent restock timestamp
                    if inv.last_restocked_at and (not existing.last_restocked_at or inv.last_restocked_at > existing.last_restocked_at):
                        existing.last_restocked_at = inv.last_restocked_at
                    existing.save()
                    inv.delete()
                    inv_merged += 1
                except Inventory.DoesNotExist:
                    inv.product = pepsi
                    inv.save()
                    inv_migrated += 1

            # Inventory transactions
            it_qs = InventoryTransaction.objects.filter(product__in=coca_qs)
            it_count = it_qs.count()
            it_qs.update(product=pepsi)

            # Mixed case components
            mcc_qs = MixedCaseComponent.objects.filter(product__in=coca_qs)
            mcc_count = mcc_qs.count()
            mcc_qs.update(product=pepsi, product_name=pepsi.name, product_sku=pepsi.sku)

            # Replacement model stores product id as string
            repl_qs = Replacement.objects.filter(replacement_product_id__in=[p.id for p in coca_qs])
            repl_count = repl_qs.count()
            repl_qs.update(replacement_product_id=pepsi.id)

            # Replacement lines
            rline_qs = ReplacementLine.objects.filter(product__in=coca_qs)
            rline_count = rline_qs.count()
            rline_qs.update(product=pepsi, product_name=pepsi.name, product_sku=pepsi.sku)

            # Finally remove the coca products
            deleted_count, _ = coca_qs.delete()

        self.stdout.write(self.style.SUCCESS(
            f"Reassigned {oi_count} OrderItem(s), processed {inv_count} Inventory row(s) ({inv_migrated} migrated, {inv_merged} merged), {it_count} InventoryTransaction(s), {mcc_count} MixedCaseComponent(s), {repl_count} Replacement(s), {rline_count} ReplacementLine(s)."
        ))
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted_count} database object(s) related to removed Coca-Cola products."))
