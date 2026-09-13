# Read-only HTTP smoke checks use no cookies, credentials, or recovery routes.
import requests,concurrent.futures,json,re,urllib3
from pathlib import Path
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
root=Path.cwd(); paths=json.loads((root/'test-reports/2026-09-13-prelaunch/inventory.json').read_text())['pages']
def check(path):
 route='/'+path.removeprefix('src/app/').removesuffix('/page.tsx').replace('page.tsx','')
 if route in ['/restore','/restore-now']:return {'route':route,'state':'NOT VERIFIED: rendering writes workspace files'}
 try:
  r=requests.get('https://localhost:3000'+route,verify=False,timeout=20,allow_redirects=False)
  return {'route':route,'status':r.status_code,'location':r.headers.get('Location'),'bytes':len(r.content),'title':re.findall(r'<title>(.*?)</title>',r.text)[:1]}
 except requests.RequestException as e:return {'route':route,'state':'NOT VERIFIED','error_type':type(e).__name__}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:out=list(pool.map(check,paths))
(root/'test-reports/2026-09-13-prelaunch/http-routes.json').write_text(json.dumps(out,indent=2));print(json.dumps(out,indent=2))
