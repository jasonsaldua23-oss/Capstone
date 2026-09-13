# Bound each test file independently so an infinite retry cannot hang the audit.
import subprocess,concurrent.futures,json
from pathlib import Path
root=Path.cwd();out=root/'test-reports/2026-09-13-prelaunch/web-by-file';out.mkdir(exist_ok=True)
files=list(root.glob('src/lib/*.test.ts'))+list(root.glob('scripts/*.test.mjs'))
def run(p):
 log=out/(p.name+'.log')
 with log.open('w',encoding='utf-8') as f:
  proc=subprocess.Popen(['node','--test','--test-reporter=tap','--experimental-strip-types',str(p)],stdout=f,stderr=subprocess.STDOUT,cwd=root)
  try:code=proc.wait(timeout=40);state='passed' if code==0 else 'failed'
  except subprocess.TimeoutExpired:
   subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);proc.wait();code=None;state='timeout'
 return {'file':str(p.relative_to(root)),'result':state,'exit_code':code,'log':str(log.relative_to(root))}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(run,files))
(root/'test-reports/2026-09-13-prelaunch/web-test-results.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results,indent=2))
