from decimal import Decimal

from django.db import migrations


PRODUCT_SKU = "7UPP-CAS-1LIT-RGB12"
CORRECTED_SKU = "7UPL-CAS-1LIT-BE75A"
CORRECTION_PREFIX = "Invalid non-glass declaration corrected: "
CORRECTION_REFERENCE = "deposit_eligibility_correction"


def remove_non_glass_deposit(apps, schema_editor):
    Product = apps.get_model("core", "Product")
    ProductPackaging = apps.get_model("core", "ProductPackaging")
    CustomerBottleBalance = apps.get_model("core", "CustomerBottleBalance")
    DepositTransaction = apps.get_model("core", "DepositTransaction")

    product = Product.objects.filter(sku=PRODUCT_SKU).first()
    if product is None:
        return

    # Fix: this catalog item is explicitly PET/plastic, so it cannot carry RGB deposits.
    product.packaging_type = "NON_RETURNABLE"
    product.sku = CORRECTED_SKU
    product.save(update_fields=["packaging_type", "sku", "updated_at"])
    ProductPackaging.objects.filter(product=product, is_active=True).update(
        is_returnable=False,
        deposit_amount=Decimal("0.00"),
        case_deposit_amount=Decimal("0.00"),
    )

    declarations = list(DepositTransaction.objects.filter(
        reference_type="product",
        reference_id=str(product.id),
        type="ADJUSTMENT",
        reason__startswith="Customer declared ",
    ).order_by("created_at"))
    for declaration in declarations:
        container_count = max(0, int(declaration.container_count or 0))
        amount = Decimal(str(declaration.amount or 0))
        balance = CustomerBottleBalance.objects.filter(
            customer_id=declaration.customer_id,
            container_type_id=declaration.container_type_id,
        ).first()
        if balance is not None:
            balance_before = Decimal(str(balance.deposit_balance or 0))
            balance.bottles_outstanding = max(0, int(balance.bottles_outstanding or 0) - container_count)
            balance.deposit_balance = max(Decimal("0.00"), balance_before - amount)
            balance.save(update_fields=["bottles_outstanding", "deposit_balance", "updated_at"])
            DepositTransaction.objects.create(
                customer_id=declaration.customer_id,
                type="REFUND",
                amount=-amount,
                balance_before=balance_before,
                balance_after=balance.deposit_balance,
                container_type_id=declaration.container_type_id,
                container_count=container_count,
                reason=f"Removed deposit recorded for non-glass product {product.name}",
                reference_type=CORRECTION_REFERENCE,
                reference_id=str(declaration.id),
                performed_by="System migration",
            )
        declaration.reason = f"{CORRECTION_PREFIX}{declaration.reason}"
        declaration.save(update_fields=["reason"])


def restore_non_glass_deposit(apps, schema_editor):
    Product = apps.get_model("core", "Product")
    ProductPackaging = apps.get_model("core", "ProductPackaging")
    CustomerBottleBalance = apps.get_model("core", "CustomerBottleBalance")
    DepositTransaction = apps.get_model("core", "DepositTransaction")

    product = Product.objects.filter(sku=CORRECTED_SKU).first()
    if product is None:
        return

    corrections = list(DepositTransaction.objects.filter(reference_type=CORRECTION_REFERENCE))
    for correction in corrections:
        declaration = DepositTransaction.objects.filter(id=correction.reference_id).first()
        if declaration is None or str(declaration.reference_id or "") != str(product.id):
            continue
        balance = CustomerBottleBalance.objects.filter(
            customer_id=correction.customer_id,
            container_type_id=correction.container_type_id,
        ).first()
        if balance is not None:
            balance.bottles_outstanding = max(0, int(balance.bottles_outstanding or 0)) + max(0, int(correction.container_count or 0))
            balance.deposit_balance = Decimal(str(balance.deposit_balance or 0)) + abs(Decimal(str(correction.amount or 0)))
            balance.save(update_fields=["bottles_outstanding", "deposit_balance", "updated_at"])
        declaration.reason = str(declaration.reason or "").removeprefix(CORRECTION_PREFIX)
        declaration.save(update_fields=["reason"])
        correction.delete()

    product.packaging_type = "RETURNABLE"
    product.sku = PRODUCT_SKU
    product.save(update_fields=["packaging_type", "sku", "updated_at"])
    ProductPackaging.objects.filter(product=product, is_active=True).update(
        is_returnable=True,
        deposit_amount=Decimal("6.00"),
        case_deposit_amount=Decimal("52.00"),
    )


class Migration(migrations.Migration):
    dependencies = [("core", "0116_fix_pepsi_1l_returnable_container")]

    operations = [
        migrations.RunPython(remove_non_glass_deposit, restore_non_glass_deposit),
    ]
