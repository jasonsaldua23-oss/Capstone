import re

with open('views_api.py', 'r', encoding='utf-8') as f:
    content = f.read()

def replace_serialize_trip(match):
    old_body = match.group(1)
    
    batching_logic = '''
        order_ids = [str(dp.order.id) for dp in drop_point_rows if getattr(dp, "order_id", None) and getattr(dp, "order", None)]
        allocations_map = _build_order_item_warehouse_allocations_map(order_ids) if order_ids else {}
        trip_assignments_map = _build_order_item_trip_assignments_map(order_ids, trip_id=str(getattr(trip, "id", "") or "").strip() or None) if order_ids else {}
        all_assignments_map = _build_order_item_trip_assignments_map(order_ids, trip_id=None) if order_ids else {}
        
        warehouse_cache = {}
        wh_ids = {str(dp.order.warehouse_id) for dp in drop_point_rows if getattr(dp, "order", None) and getattr(dp.order, "warehouse_id", None)}
        if wh_ids:
            warehouse_cache = {str(w.id): w for w in Warehouse.objects.filter(id__in=wh_ids)}
            
        order_returns_map = {}
        if order_ids:
            from core.models import Replacement
            replacements = Replacement.objects.filter(order_id__in=order_ids)
            for r in replacements:
                order_returns_map.setdefault(str(r.order_id), []).append(r)

        for dp in drop_point_rows:'''

    new_body = old_body.replace('        for dp in drop_point_rows:', batching_logic)
    
    new_body = new_body.replace(
        'item_allocations_by_order = _build_order_item_warehouse_allocations_map([str(dp.order.id)]).get(str(dp.order.id), {})',
        'item_allocations_by_order = allocations_map.get(str(dp.order.id), {})'
    )
    new_body = new_body.replace(
        'item_trip_assignments_by_order = _build_order_item_trip_assignments_map(\n                    [str(dp.order.id)],\n                    trip_id=str(getattr(trip, "id", "") or "").strip() or None,\n                ).get(str(dp.order.id), {})',
        'item_trip_assignments_by_order = trip_assignments_map.get(str(dp.order.id), {})'
    )
    new_body = new_body.replace(
        'all_item_trip_assignments_by_order = _build_order_item_trip_assignments_map(\n                    [str(dp.order.id)],\n                    trip_id=None,  # Don\'t filter by trip - get all assignments\n                ).get(str(dp.order.id), {})',
        'all_item_trip_assignments_by_order = all_assignments_map.get(str(dp.order.id), {})'
    )
    
    new_body = re.sub(
        r'try:\s+order_returns = list\(dp\.order\.replacements\.all\(\)\)\s+except Exception:\s+order_returns = \[\]',
        'order_returns = order_returns_map.get(str(dp.order.id), [])',
        new_body
    )
    
    new_body = new_body.replace(
        'order_warehouse = Warehouse.objects.filter(id=order_warehouse_id).first() if order_warehouse_id else None',
        'order_warehouse = warehouse_cache.get(order_warehouse_id)'
    )

    return f"def _serialize_trip(trip: Trip, include_points: bool = True) -> dict[str, Any]:{new_body}\n    return data"

pattern = re.compile(r'def _serialize_trip\(trip: Trip, include_points: bool = True\) -> dict\[str, Any\]:(.*?)\n    return data', re.DOTALL)
new_content = pattern.sub(replace_serialize_trip, content)

with open('views_api.py', 'w', encoding='utf-8') as f:
    f.write(new_content)
print("Patched!")
