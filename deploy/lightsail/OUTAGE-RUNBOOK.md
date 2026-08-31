# Why the backend goes down, and how to find out which cause it was

The API is `gunicorn -> Nginx` on the Lightsail box at `18.138.158.32`
(`api.annannsbeveragestrading.com`). The Next.js frontend runs on the **same box**
under pm2, and `next.config.ts` rewrites `/api/:path*` to Django. So the API's
availability is the product of two processes plus one shared pool of RAM: if
either the Node process or the Python process dies, users report "the backend is
down", and they cannot tell the two apart.

## First: which layer is actually down?

Run these from your machine. They separate the layers in about ten seconds.

```bash
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' https://api.annannsbeveragestrading.com/api/health        # gunicorn alive?
curl -sS https://api.annannsbeveragestrading.com/api/health/ready                                                  # can it reach Postgres?
curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' https://warehouse.annannsbeveragestrading.com/api/health  # is the Next proxy alive?
```

| Result | Layer at fault |
| --- | --- |
| Both direct probes fail to connect | Nginx down, instance rebooted, or the box is out of memory |
| `/api/health` 200, `/api/health/ready` 503 | Django is up; Supabase is unreachable or the pooler refused the connection |
| Both direct probes 200, the frontend host fails | pm2 / the Next process, not the API |
| Everything 200 but slow (>10s) | Worker starvation - see "Worker starvation" below |

## Then: which cause was it?

On the box:

```bash
# 1. Did the kernel kill something? This is the single most common cause here.
sudo journalctl -k --since '24 hours ago' | grep -i -E 'out of memory|oom-kill|killed process'

# 2. How often has the API restarted, and why did it exit?
systemctl show aabtrading-django -p NRestarts
sudo journalctl -u aabtrading-django --since '24 hours ago' | grep -E 'Started|Stopped|Main process exited|WORKER TIMEOUT|Booting worker'

# 3. Disk full? A full disk breaks Nginx, the build and the logs simultaneously.
df -h /
sudo journalctl --disk-usage

# 4. Memory headroom right now, and whether swap exists at all.
free -m

# 5. Did the outage line up with a deploy?
git -C /srv/aabtrading log -5 --format='%h %ad %s' --date=iso
```

`WORKER TIMEOUT` in step 2 means starvation, not a crash. `oom-kill` in step 1
means memory. Neither, plus `Main process exited`, means an unhandled crash -
read the traceback directly above it in the journal.

## The four causes this repo is built to hit

### 1. Deploying rebuilds the frontend on the production box

`.github/workflows/deploy.yml` runs `npm ci && npm run build` over SSH on the live
instance. `npm ci` deletes `node_modules` first, so the frontend is broken for the
duration; `next build` then peaks well above what a 1-2GB instance has free. With
no swap, the kernel OOM killer resolves that by killing the largest resident
process - which has been gunicorn. **A frontend deploy takes the API down.**

Fixed by: the swap guard, `NODE_OPTIONS=--max-old-space-size=1024`, the
conditional `npm ci`, and `pm2 reload` (not `restart`) in the workflow, plus
`OOMScoreAdjust=-500` on the API from `server-hardening.sh`.

### 2. Worker starvation

The service previously ran `--workers 2` with the default **sync** worker class.
A sync worker serves exactly one request start to finish, and several endpoints
block on remote I/O for seconds: OTP mail is sent inside the request (`EMAIL_TIMEOUT`
10s, Gmail API 15s + 20s), uploads accept 25MB and run Pillow over them, and every
query crosses the network to the Supabase pooler in `ap-southeast-1`. Two such
requests occupied both workers and everything else queued until Nginx hit
`proxy_read_timeout 120s`. The process was alive and completely unable to answer.

Fixed by: `--worker-class gthread --workers 3 --threads 8` (concurrency 2 -> 24).
The real fix is moving OTP mail out of the request path onto a queue; the thread
spawns at `core/views_api.py:9765` and in `core/push_notifications.py` show the
pattern already in use for replacement mail and web push.

### 3. Monitoring could not see the outage

`/api/health` returned static JSON without touching the database, so it answered
200 through outages where every real endpoint was failing. `/api/health/ready`
(added) runs `SELECT 1` and returns 503 when Postgres is unreachable. Point
UptimeRobot, the platform health check and the post-deploy gate at **ready**.

`server-hardening.sh` also installs a two-minute systemd timer that restarts the
API when readiness fails - covering the case systemd cannot see, where the process
is alive but wedged.

### 4. Config drift from a stray `.env`

`backend/config/settings.py` loaded `.env` with `override=True`, and the deployed
tree is the same checkout as development. A `.env` copied to the server silently
outranked the systemd `EnvironmentFile` and could repoint `DATABASE_URL`, re-enable
`DEBUG` (which makes Django retain every SQL query in memory until the process is
OOM-killed) or widen `ALLOWED_HOSTS`, with nothing in the logs to say so.
Production now sets `DOTENV_OVERRIDE=0` so the real process environment wins.

## Applying the fixes to the running server

```bash
cd /srv/aabtrading && git pull origin main
sudo cp deploy/lightsail/aabtrading-django.service /etc/systemd/system/
sudo cp deploy/lightsail/aabtrading-backend-production.env /etc/aabtrading-backend-production.env
sudo bash deploy/lightsail/server-hardening.sh     # swap, OOM priority, log cap, watchdog
sudo systemctl daemon-reload && sudo systemctl restart aabtrading-django
curl -fsS http://127.0.0.1:8000/api/health/ready   # must print database: ok
```

The deploy workflow now runs `sudo systemctl restart aabtrading-django`, so the
deploy user needs a passwordless sudoers entry for exactly that:

```bash
echo 'ubuntu ALL=(root) NOPASSWD: /bin/systemctl restart aabtrading-django, /bin/systemctl status aabtrading-django' \
  | sudo tee /etc/sudoers.d/aabtrading-deploy
sudo chmod 440 /etc/sudoers.d/aabtrading-deploy
```

## Two things still worth checking

- **Port 80 on `18.138.158.32` refuses connections from outside** while 443 works.
  `aabtrading-backend-production.env` sets `DJANGO_API_ORIGIN=http://18.138.158.32`,
  and `next.config.ts` proxies every `/api/*` call to that origin. If the live value
  is still the plain-HTTP one, confirm it resolves over loopback; otherwise point it
  at `https://api.annannsbeveragestrading.com`.
- **`aabtrading-api.nginx` in this repo only has a `listen 80` block**, but the live
  server answers TLS. The deployed Nginx config has diverged from the one in git -
  copy the live file back so the next rebuild does not lose the certificate config.
