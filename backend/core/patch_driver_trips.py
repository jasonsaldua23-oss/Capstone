import re

with open('views_api.py', 'r', encoding='utf-8') as f:
    content = f.read()

def patch_serialize_trip(match):
    body = match.group(1)
    
    sig = "def _serialize_trip(trip: Trip, include_points: bool = True, *, ctx: dict = None) -> dict[str, Any]:\n    if ctx is None: ctx = {}"
    
    old_batching = '''        order_ids = [str(dp.order.id) for dp in drop_point_rows if getattr(dp, "order_id", None) and getattr(dp, "order", None)]
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
                order_returns_map.setdefault(str(r.order_id), []).append(r)'''

    new_batching = '''        order_ids = [str(dp.order.id) for dp in drop_point_rows if getattr(dp, "order_id", None) and getattr(dp, "order", None)]
        
        allocations_map = ctx.get("allocations_map")
        if allocations_map is None:
            allocations_map = _build_order_item_warehouse_allocations_map(order_ids) if order_ids else {}
            
        trip_assignments_map = ctx.get("trip_assignments_map")
        if trip_assignments_map is None:
            trip_assignments_map = _build_order_item_trip_assignments_map(order_ids, trip_id=str(getattr(trip, "id", "") or "").strip() or None) if order_ids else {}
            
        all_assignments_map = ctx.get("all_assignments_map")
        if all_assignments_map is None:
            all_assignments_map = _build_order_item_trip_assignments_map(order_ids, trip_id=None) if order_ids else {}
            
        warehouse_cache = ctx.get("warehouse_cache")
        if warehouse_cache is None:
            warehouse_cache = {}
            wh_ids = {str(dp.order.warehouse_id) for dp in drop_point_rows if getattr(dp, "order", None) and getattr(dp.order, "warehouse_id", None)}
            if trip.warehouse_id: wh_ids.add(str(trip.warehouse_id))
            if wh_ids:
                warehouse_cache = {str(w.id): w for w in Warehouse.objects.filter(id__in=wh_ids)}
                
        order_returns_map = ctx.get("order_returns_map")
        if order_returns_map is None:
            order_returns_map = {}
            if order_ids:
                from core.models import Replacement
                replacements = Replacement.objects.filter(order_id__in=order_ids)
                for r in replacements:
                    order_returns_map.setdefault(str(r.order_id), []).append(r)'''

    body = body.replace(old_batching, new_batching)
    return f"{sig}{body}"

content = re.sub(r'def _serialize_trip\(trip: Trip, include_points: bool = True\) -> dict\[str, Any\]:(.*?return data\n)', patch_serialize_trip, content, flags=re.DOTALL)


def patch_driver_trips(match):
    old_driver_trips = match.group(0)
    
    ctx_building_logic = '''
    all_order_ids = []
    all_wh_ids = set()
    for trip in rows:
        if trip.warehouse_id:
            all_wh_ids.add(str(trip.warehouse_id))
        prefetched_dp = getattr(trip, "_prefetched_objects_cache", {}).get("drop_points")
        if prefetched_dp is not None:
            for dp in prefetched_dp:
                if getattr(dp, "order", None):
                    all_order_ids.append(str(dp.order.id))
                    if dp.order.warehouse_id:
                        all_wh_ids.add(str(dp.order.warehouse_id))
                        
    ctx = {
        "allocations_map": _build_order_item_warehouse_allocations_map(all_order_ids) if all_order_ids else {},
        "all_assignments_map": _build_order_item_trip_assignments_map(all_order_ids, trip_id=None) if all_order_ids else {},
        "warehouse_cache": {str(w.id): w for w in Warehouse.objects.filter(id__in=all_wh_ids)} if all_wh_ids else {},
        "order_returns_map": {},
        "trip_assignments_map": None, 
    }
    
    if all_order_ids:
        from core.models import Replacement
        replacements = Replacement.objects.filter(order_id__in=all_order_ids)
        for r in replacements:
            ctx["order_returns_map"].setdefault(str(r.order_id), []).append(r)

    payload_rows = []
    for trip in rows:
        row = _serialize_trip(trip, ctx=ctx)'''

    new_driver_trips = re.sub(r'payload_rows: list\[dict\[str, Any\]\] = \[\]\n    for trip in rows:\n        row = _serialize_trip\(trip\)', ctx_building_logic, old_driver_trips)
    return new_driver_trips

content = re.sub(r'def driver_trips\(.*?payload_rows: list\[dict\[str, Any\]\] = \[\]\n    for trip in rows:\n        row = _serialize_trip\(trip\)', patch_driver_trips, content, flags=re.DOTALL)

with open('views_api.py', 'w', encoding='utf-8') as f:
    f.write(content)
print("Patched driver_trips!")
