from decimal import Decimal

from django.db import migrations


PRODUCT_SKU = "7UPP-CAS-1LIT-RGB12"
OLD_CONTAINER_CODE = "RGB-GLASS-330"
NEW_CONTAINER_CODE = "RGB-GLASS-1L"
CONTAINERS_PER_CASE = 12
OLD_CASE_DEPOSIT = Decimal("42.00")
NEW_BOTTLE_DEPOSIT = Decimal("6.00")
NEW_CASE_DEPOSIT = Decimal("52.00")


def _priced_amount(container_count, case_deposit, bottle_deposit):
    cases, loose_bottles = divmod(max(0, int(container_count or 0)), CONTAINERS_PER_CASE)
    return (case_deposit * cases) + (bottle_deposit * loose_bottles)


def move_7up_1l_to_1l_container(apps, schema_editor):
    Product = apps.get_model("core", "Product")
    ProductPackaging = apps.get_model("core", "ProductPackaging")
    ContainerType = apps.get_model("core", "ContainerType")
    CustomerBottleBalance = apps.get_model("core", "CustomerBottleBalance")
    DepositTransaction = apps.get_model("core", "DepositTransaction")

    product = Product.objects.filter(sku=PRODUCT_SKU).first()
    old_container = ContainerType.objects.filter(code=OLD_CONTAINER_CODE).first()
    new_container = ContainerType.objects.filter(code=NEW_CONTAINER_CODE).first()
    if product is None or old_container is None or new_container is None:
        return

    # Fix: this SKU is a 1L RGB case and must not share the 330ml bottle pool.
    ProductPackaging.objects.filter(product=product, container_type=old_container).update(
        container_type=new_container,
        containers_per_case=CONTAINERS_PER_CASE,
        deposit_amount=NEW_BOTTLE_DEPOSIT,
        case_deposit_amount=NEW_CASE_DEPOSIT,
    )

    declarations = list(DepositTransaction.objects.filter(
        reference_type="product",
        reference_id=str(product.id),
        type="ADJUSTMENT",
        container_type=old_container,
        reason__startswith="Customer declared ",
    ).order_by("created_at"))

    for declaration in declarations:
        container_count = max(0, int(declaration.container_count or 0))
        old_amount = Decimal(str(declaration.amount or 0))
        corrected_amount = _priced_amount(container_count, NEW_CASE_DEPOSIT, NEW_BOTTLE_DEPOSIT)

        old_balance = CustomerBottleBalance.objects.filter(
            customer_id=declaration.customer_id,
            container_type=old_container,
        ).first()
        if old_balance is not None:
            old_balance.bottles_outstanding = max(0, int(old_balance.bottles_outstanding or 0) - container_count)
            old_balance.deposit_balance = max(Decimal("0.00"), Decimal(str(old_balance.deposit_balance or 0)) - old_amount)
            old_balance.save(update_fields=["bottles_outstanding", "deposit_balance", "updated_at"])

        new_balance, _ = CustomerBottleBalance.objects.get_or_create(
            customer_id=declaration.customer_id,
            container_type=new_container,
            defaults={"bottles_outstanding": 0, "deposit_balance": Decimal("0.00")},
        )
        balance_before = Decimal(str(new_balance.deposit_balance or 0))
        new_balance.bottles_outstanding = max(0, int(new_balance.bottles_outstanding or 0)) + container_count
        new_balance.deposit_balance = balance_before + corrected_amount
        new_balance.save(update_fields=["bottles_outstanding", "deposit_balance", "updated_at"])

        declaration.container_type = new_container
        declaration.amount = corrected_amount
        declaration.balance_before = balance_before
        declaration.balance_after = new_balance.deposit_balance
        declaration.save(update_fields=["container_type", "amount", "balance_before", "balance_after"])


def move_7up_1l_back_to_330ml_container(apps, schema_editor):
    Product = apps.get_model("core", "Product")
    ProductPackaging = apps.get_model("core", "ProductPackaging")
    ContainerType = apps.get_model("core", "ContainerType")
    CustomerBottleBalance = apps.get_model("core", "CustomerBottleBalance")
    DepositTransaction = apps.get_model("core", "DepositTransaction")

    product = Product.objects.filter(sku=PRODUCT_SKU).first()
    old_container = ContainerType.objects.filter(code=OLD_CONTAINER_CODE).first()
    new_container = ContainerType.objects.filter(code=NEW_CONTAINER_CODE).first()
    if product is None or old_container is None or new_container is None:
        return

    ProductPackaging.objects.filter(product=product, container_type=new_container).update(
        container_type=old_container,
        containers_per_case=CONTAINERS_PER_CASE,
        deposit_amount=Decimal("0.00"),
        case_deposit_amount=Decimal("0.00"),
    )

    declarations = list(DepositTransaction.objects.filter(
        reference_type="product",
        reference_id=str(product.id),
        type="ADJUSTMENT",
        container_type=new_container,
        reason__startswith="Customer declared ",
    ).order_by("created_at"))
    for declaration in declarations:
        container_count = max(0, int(declaration.container_count or 0))
        new_amount = Decimal(str(declaration.amount or 0))
        old_amount = _priced_amount(container_count, OLD_CASE_DEPOSIT, Decimal("2.00"))

        new_balance = CustomerBottleBalance.objects.filter(
            customer_id=declaration.customer_id,
            container_type=new_container,
        ).first()
        if new_balance is not None:
            new_balance.bottles_outstanding = max(0, int(new_balance.bottles_outstanding or 0) - container_count)
            new_balance.deposit_balance = max(Decimal("0.00"), Decimal(str(new_balance.deposit_balance or 0)) - new_amount)
            new_balance.save(update_fields=["bottles_outstanding", "deposit_balance", "updated_at"])

        old_balance, _ = CustomerBottleBalance.objects.get_or_create(
            customer_id=declaration.customer_id,
            container_type=old_container,
            defaults={"bottles_outstanding": 0, "deposit_balance": Decimal("0.00")},
        )
        balance_before = Decimal(str(old_balance.deposit_balance or 0))
        old_balance.bottles_outstanding = max(0, int(old_balance.bottles_outstanding or 0)) + container_count
        old_balance.deposit_balance = balance_before + old_amount
        old_balance.save(update_fields=["bottles_outstanding", "deposit_balance", "updated_at"])

        declaration.container_type = old_container
        declaration.amount = old_amount
        declaration.balance_before = balance_before
        declaration.balance_after = old_balance.deposit_balance
        declaration.save(update_fields=["container_type", "amount", "balance_before", "balance_after"])


class Migration(migrations.Migration):
    dependencies = [("core", "0114_unique_staff_email")]

    operations = [
        migrations.RunPython(move_7up_1l_to_1l_container, move_7up_1l_back_to_330ml_container),
    ]
