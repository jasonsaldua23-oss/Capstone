"""Keep immutable purchase requests separate from operational transactions and POs."""

import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.forms.models import model_to_dict
from django.utils import timezone

from .models import Order, PurchaseOrder, PurchaseRequest, PurchaseRequestStatus, Replacement, SalesChannel


def product_snapshot(product):
    # Keep receipt display details, not unrelated mutable catalog configuration.
    fields = ('id', 'name', 'sku', 'image_url', 'category', 'sizes', 'unit', 'quantity_per_unit')
    return {field: getattr(product, field) for field in fields} if product else None


def request_snapshot(order):
    snapshot = model_to_dict(order)
    snapshot['id'] = order.pk
    snapshot['items'] = []
    for item in order.items.select_related('product').prefetch_related('mixed_case_components__product').all():
        line = model_to_dict(item)
        line['id'] = item.pk
        line['product'] = product_snapshot(item.product)
        line['mixed_case_components'] = []
        for component in item.mixed_case_components.all():
            part = model_to_dict(component)
            part['id'] = component.pk
            part['product'] = product_snapshot(component.product)
            line['mixed_case_components'].append(part)
        snapshot['items'].append(line)
    # A PO cancellation/rejection is not a cancellation/rejection of its approved PR.
    if order.request_status == PurchaseRequestStatus.APPROVED:
        for field in ('cancellation_reason', 'cancelled_at', 'cancelled_by_name', 'cancelled_by_user_id',
                      'rejection_reason', 'rejected_at', 'rejected_by_name', 'rejected_by_user_id'):
            snapshot[field] = None
    return json.loads(json.dumps(snapshot, cls=DjangoJSONEncoder))


@transaction.atomic
def sync_purchase_documents(order):
    if order.sales_channel == SalesChannel.RETAIL_POS or order.order_number.upper().startswith('RPL-'):
        return
    # Legacy replacement deliveries may have an older non-RPL number.
    if Replacement.objects.filter(delivery_transaction=order).exists():
        return
    # Lock the shared transaction first so approval and retries create a single PO.
    order = Order.objects.select_for_update().get(pk=order.pk)
    request = PurchaseRequest.objects.select_for_update().filter(transaction=order).first()
    if request is None:
        request = PurchaseRequest(transaction=order, number=order.purchase_request_number or f'PR-{order.pk}',
                                  status=order.request_status, created_at=order.created_at)
    if not request.locked_at:
        request.status = order.request_status
        request.number = order.purchase_request_number or request.number
        request.snapshot = request_snapshot(order)
        if order.request_status == PurchaseRequestStatus.APPROVED or order.purchase_order_number:
            request.status = PurchaseRequestStatus.APPROVED
            request.locked_at = order.approved_at or timezone.now()
        request.save()
    if request.locked_at:
        PurchaseOrder.objects.get_or_create(
            transaction=order,
            defaults={'purchase_request': request, 'number': order.purchase_order_number or order.order_number,
                      'approved_at': order.approved_at},
        )


@receiver(post_save, sender=Order, dispatch_uid='core.purchase_documents')
def save_purchase_documents(sender, instance, raw=False, **kwargs):
    if not raw:
        sync_purchase_documents(instance)
