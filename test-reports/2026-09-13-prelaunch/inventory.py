# Produce inventories for explicit coverage tracking; never collect API payloads or secrets.
import ast,re,json,subprocess
from pathlib import Path
root=Path.cwd()
files=[Path(x) for x in subprocess.check_output(['git','ls-files','-z']).decode().split('\0') if x]
inventory={'pages':[],'forms':[],'api_calls':[],'models':[],'tests':[]}
for p in files:
 if not p.is_file():continue
 if p.suffix in ['.tsx','.ts','.mjs'] and any(str(p).startswith(x) for x in ['src','mobile','shared']):
  txt=p.read_text(encoding='utf-8',errors='replace')
  if p.name=='page.tsx':inventory['pages'].append(str(p).replace('\\','/'))
  for n,line in enumerate(txt.splitlines(),1):
   if re.search(r'<form\b|onSubmit=|handleSubmit\s*=',line):inventory['forms'].append({'file':str(p),'line':n})
   for m in re.finditer(r'''['"`](/api/[^'"`\s]*)''',line):inventory['api_calls'].append({'file':str(p),'line':n,'url_pattern':m[1]})
 if 'test' in p.name and p.suffix in ['.py','.ts','.mjs']:inventory['tests'].append(str(p))
model_ast=ast.parse((root/'backend/core/models.py').read_text())
for node in model_ast.body:
 if isinstance(node,ast.ClassDef) and any(isinstance(b,ast.Attribute) and b.attr=='Model' for b in node.bases):inventory['models'].append({'name':node.name,'line':node.lineno})
(root/'test-reports/2026-09-13-prelaunch/inventory.json').write_text(json.dumps(inventory,indent=2))
print({k:len(v) for k,v in inventory.items()})
