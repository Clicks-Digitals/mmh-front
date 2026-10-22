#!/bin/sh
set -e

# RUN_MODE=jobs: one-shot scheduled jobs (Railway cron service). No migrations, no web server.
if [ "${RUN_MODE:-web}" = "jobs" ]; then
  python manage.py run_scheduled_jobs
  exit $?
fi

python manage.py migrate --noinput
# Shared cache table used by DRF throttling (idempotent).
python manage.py createcachetable
python manage.py collectstatic --noinput

exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-2}" \
  --timeout 120 \
  --access-logfile - \
  --error-logfile -
