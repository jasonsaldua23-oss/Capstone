#!/usr/bin/env bash
# One-time hardening for the Lightsail box that runs Nginx + the Next.js frontend
# + the Django API. Safe to re-run; every step is idempotent.
#
#   sudo bash deploy/lightsail/server-hardening.sh
#
# Background: the instance runs `next build` in place on every push to main. That
# build peaks far above what is free on a 1-2GB instance. With no swap the kernel
# OOM killer resolves the shortage by killing the largest resident process, which
# has repeatedly been gunicorn - so a frontend deploy took the API down.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo." >&2
  exit 1
fi

SWAPFILE=/swapfile
SWAP_SIZE_MB=2048

# ---------------------------------------------------------------- swap
if ! swapon --show --noheadings | grep -q .; then
  echo "==> creating ${SWAP_SIZE_MB}MB swapfile at ${SWAPFILE}"
  fallocate -l "${SWAP_SIZE_MB}M" "$SWAPFILE" || dd if=/dev/zero of="$SWAPFILE" bs=1M count="$SWAP_SIZE_MB"
  chmod 600 "$SWAPFILE"
  mkswap "$SWAPFILE"
  swapon "$SWAPFILE"
  grep -q "^${SWAPFILE}" /etc/fstab || echo "${SWAPFILE} none swap sw 0 0" >> /etc/fstab
else
  echo "==> swap already present, skipping"
fi

# Prefer reclaiming page cache over swapping out a live server process, but still
# allow swap as the safety net that keeps the build from triggering an OOM kill.
sysctl -w vm.swappiness=10
grep -q "^vm.swappiness" /etc/sysctl.d/99-aabtrading.conf 2>/dev/null \
  || echo "vm.swappiness=10" >> /etc/sysctl.d/99-aabtrading.conf

# --------------------------------------------------- protect the API from the OOM killer
# If memory does run out, the API is the last thing that should be sacrificed.
# A negative oom_score_adj makes the kernel pick the Node build process instead.
mkdir -p /etc/systemd/system/aabtrading-django.service.d
cat > /etc/systemd/system/aabtrading-django.service.d/oom.conf <<'CONF'
[Service]
OOMScoreAdjust=-500
CONF

systemctl daemon-reload
systemctl restart aabtrading-django

# ---------------------------------------------------------------- journald cap
# Gunicorn logs every request to stdout, which journald persists. Cap it so logs
# cannot fill the disk - a full disk takes down Nginx, Postgres clients and the
# build all at once, and looks exactly like "the backend went down again".
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/99-aabtrading.conf <<'CONF'
[Journal]
SystemMaxUse=500M
SystemKeepFree=1G
MaxRetentionSec=14day
CONF
systemctl restart systemd-journald

# ---------------------------------------------------------------- watchdog
# systemd restarts the process when it exits, but not when it is alive and unable
# to reach Postgres. This timer checks readiness and restarts on a real failure.
cat > /etc/systemd/system/aabtrading-django-watchdog.service <<'CONF'
[Unit]
Description=Restart the AAB Trading Django API when its readiness probe fails
After=aabtrading-django.service

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash -c 'curl -fsS --max-time 15 http://127.0.0.1:8000/api/health/ready > /dev/null || systemctl restart aabtrading-django'
CONF

cat > /etc/systemd/system/aabtrading-django-watchdog.timer <<'CONF'
[Unit]
Description=Run the AAB Trading Django readiness watchdog every two minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=2min
AccuracySec=15s

[Install]
WantedBy=timers.target
CONF

systemctl daemon-reload
systemctl enable --now aabtrading-django-watchdog.timer

echo
echo "==> done"
free -m
systemctl --no-pager --lines 5 status aabtrading-django || true
