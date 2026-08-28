import re

with open('App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('trackColor={{ false: "#cbd5e1", true: "#0d61ad" }}', 'trackColor={{ false: "#cbd5e1", true: "#0f766e" }}')

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Patched App.tsx!")
