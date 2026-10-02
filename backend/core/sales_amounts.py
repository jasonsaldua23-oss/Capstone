"""What counts as a sale in revenue and spend figures.

The web reports apply the same rule through getOrderSalesAmount in
src/lib/report-metrics.ts; keep the two in step.
"""

from django.db.models import ExpressionWrapper, F, FloatField, Q

# Goods after discount. total_amount also carries the net container deposit and any
# deposit credit applied at checkout: money held against the empties, not sales.
SALES_AMOUNT = ExpressionWrapper(F("subtotal") - F("discount"), output_field=FloatField())

# A replacement delivery makes good an earlier sale, so it is not a sale of its own.
REPLACEMENT_ORDER = Q(order_number__istartswith="RPL-")
