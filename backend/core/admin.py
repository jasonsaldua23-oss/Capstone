from django.contrib import admin

from .models import (
    Customer,
    Inventory,
    InventoryReservation,
    MixedCaseComponent,
    Order,
    PackagingProfile,
    Product,
    ReplacementLine,
    ReturnReceipt,
    Trip,
    User,
    Vehicle,
    Warehouse,
)


@admin.register(Warehouse)
class WarehouseAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return super().has_add_permission(request) and not Warehouse.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

admin.site.register(User)
admin.site.register(Customer)
admin.site.register(Product)
admin.site.register(Inventory)
admin.site.register(Order)
admin.site.register(Vehicle)
admin.site.register(Trip)
admin.site.register(PackagingProfile)
admin.site.register(MixedCaseComponent)
admin.site.register(InventoryReservation)
admin.site.register(ReplacementLine)
admin.site.register(ReturnReceipt)

