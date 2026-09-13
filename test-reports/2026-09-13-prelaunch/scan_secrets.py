# Scan tracked text and local environment files; emit locations/classifications only.
import subprocess,re,json,zipfile,tarfile,sqlite3
from pathlib import Path
root=Path.cwd(); tracked=subprocess.check_output(['git','ls-files','-z']).decode().split('\0'); findings=[]
patterns={
 'private_key':re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
 'jwt_literal':re.compile(r'eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}'),
 'provider_secret':re.compile(r'(?:sb_secret_|sk_live_|AKIA|AIzaSy)[A-Za-z0-9_-]{15,}'),
 'credential_url':re.compile(r'(?:postgres(?:ql)?|mysql)://[^\s:/]+:[^\s@]+@'),
}
for rel in tracked:
 p=root/rel
 if not p.is_file() or p.stat().st_size>8_000_000:continue
 try: data=p.read_text(encoding='utf-8')
 except (UnicodeError,OSError):continue
 for number,line in enumerate(data.splitlines(),1):
  for kind,pat in patterns.items():
   if pat.search(line):findings.append({'path':rel,'line':number,'kind':kind})
for rel in ['.env','backend/.env','deploy/lightsail/aabtrading-backend-production.env']:
 p=root/rel
 if p.exists():
  for n,line in enumerate(p.read_text().splitlines(),1):
   m=re.match(r'\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)',line)
   if m and re.search('SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL|DEBUG|CORS|SSL_VERIFY',m[1]):
    findings.append({'path':rel,'line':n,'key':m[1],'configured':bool(m[2].strip()),'tracked':rel in tracked})
archives=[]
for rel in tracked:
 p=root/rel
 if not p.is_file():continue
 try:
  if rel.endswith('.tar.gz'):
   with tarfile.open(p) as a:
    names=a.getnames(); archives.append({'path':rel,'members':len(names),'sensitive_names':[n for n in names if re.search(r'(?:^|/)\.env$|\.sqlite3|\.pem$|\.sql$|\.dump$',n)]})
  elif rel.endswith('.zip'):
   with zipfile.ZipFile(p) as a:archives.append({'path':rel,'members':len(a.namelist()),'sensitive_names':[n for n in a.namelist() if re.search(r'\.sqlite3|\.sql$|\.dump$|\.json$',n)]})
  elif rel.endswith('.sqlite3.bak'):
   # Immutable inspection avoids creating SQLite WAL/shared-memory companion files.
   db=sqlite3.connect(p.as_uri()+'?mode=ro&immutable=1',uri=True)
   tables=[r[0] for r in db.execute("select name from sqlite_master where type='table'")]
   counts={t:db.execute('select count(*) from "'+t.replace('"','""')+'"').fetchone()[0] for t in tables if t in ['User','Customer','Order']}
   archives.append({'path':rel,'table_count':len(tables),'row_counts':counts});db.close()
 except Exception as e:archives.append({'path':rel,'error_type':type(e).__name__})
out={'matches':findings,'archives':archives}
(root/'test-reports/2026-09-13-prelaunch/secret-scan.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
