import re

files = [
    r"c:\CAPSTONE\src\components\portals\admin\sections\transportation-view.tsx",
    r"c:\CAPSTONE\src\components\portals\warehouse\WarehouseTripsSection.tsx",
    r"c:\CAPSTONE\src\components\portals\admin\sections\trips-view.tsx"
]

for file_path in files:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # The block looks like this:
    # {Array.isArray(selectedDropPointDetail.order?.items) && selectedDropPointDetail.order.items.length > 0 ? (
    #   <div className="space-y-2 text-sm">
    
    # We'll replace it specifically.
    target = 'selectedDropPointDetail.order.items.length > 0 ? (\n                  <div className="space-y-2 text-sm">'
    replacement = 'selectedDropPointDetail.order.items.length > 0 ? (\n                  <div className="space-y-2 text-sm max-h-[220px] overflow-y-auto pr-1">'
    
    if target in content:
        content = content.replace(target, replacement)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Patched {file_path}")
    else:
        print(f"Target not found in {file_path}")
