#!/bin/sh
set -e
echo "[start] applying migrations"
alembic upgrade head
echo "[start] seeding (skipped if data exists)"
python -m app.seed.seed --if-empty --graph "${GRAPH_SOURCE:-synthetic}"
echo "[start] launching API with ${WEB_WORKERS:-4} workers"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "${WEB_WORKERS:-4}" --proxy-headers
