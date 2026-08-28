import re

with open('App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

def dedupe_font_family(match):
    style_content = match.group(1)
    
    families = re.findall(r'fontFamily:\s*"([^"]+)"', style_content)
    if len(families) > 1:
        first_family = families[0]
        style_content = re.sub(r',\s*fontFamily:\s*"[^"]+"', '', style_content)
        style_content = re.sub(r'fontFamily:\s*"[^"]+",\s*', '', style_content)
        style_content = f'fontFamily: "{first_family}", ' + style_content
        return '{' + style_content + '}'
    
    return match.group(0)

content = re.sub(r'\{([^}]+)\}', dedupe_font_family, content)

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Patched App.tsx!")
