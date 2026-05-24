from django.contrib import admin

from .models import Customer, Inventory, Order, Product, Trip, User, Vehicle, Warehouse

admin.site.register(User)
admin.site.register(Customer)
admin.site.register(Warehouse)
admin.site.register(Product)
admin.site.register(Inventory)
admin.site.register(Order)
admin.site.register(Vehicle)
admin.site.register(Trip)

