import re

with open('App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix confirmation modal Cancel button
content = content.replace('confirmCancelButton: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: "#d1d5db"', 'confirmCancelButton: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: "#eab308"')

# Fix Logout red button (b91c1c -> dc2626)
content = content.replace('dangerButton: {\n    backgroundColor: "#b91c1c"', 'dangerButton: {\n    backgroundColor: "#dc2626"')

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Patched App.tsx!")
