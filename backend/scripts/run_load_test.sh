#!/bin/sh
# Isolated load test: its own uvicorn (4 workers) on the TEST database and Redis DB 14, so the running
# dev stack and its users are not affected.
#   docker compose run --rm api sh scripts/run_load_test.sh
set -e
export DATABASE_URL="${TEST_DATABASE_URL:?TEST_DATABASE_URL is required}"
export REDIS_URL="redis://redis:6379/14"
export EXTERNAL_ROUTING_URL="" EXTERNAL_ROUTING_FAULT_URL=""
export DB_POOL_SIZE="${DB_POOL_SIZE:-8}" DB_MAX_OVERFLOW="${DB_MAX_OVERFLOW:-4}"
WORKERS="${LOAD_WORKERS:-4}"

python - <<'EOF'
import asyncio
from sqlalchemy import text
from app.db import engine
from app.models import Base
async def main():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
asyncio.run(main())
EOF
python -m app.seed.seed --graph synthetic

# same topology as docker compose: API workers only serve requests, one worker process does the rest
CRISIS_CONSUMERS_PER_WORKER=0 ENABLE_BACKGROUND_TASKS=false \
uvicorn app.main:app --host 127.0.0.1 --port 8100 --workers "$WORKERS" --proxy-headers \
    --log-level warning --no-access-log &
SERVER=$!
python -m app.worker > /tmp/worker.log 2>&1 &
for _ in $(seq 1 60); do
    python -c "import httpx,sys; sys.exit(0 if httpx.get('http://127.0.0.1:8100/health').status_code==200 else 1)" \
        2>/dev/null && break
    sleep 1
done
echo "server up with $WORKERS workers"
if [ "$1" = "--serve" ]; then
    # k6 mode: prepare the burst, signal readiness, keep serving until the container is stopped
    shift
    rm -f scripts/.lt_ready
    python scripts/load_test.py --base-url http://127.0.0.1:8100 --backdate --prepare-out scripts/.lt_jobs.json "$@"
    touch scripts/.lt_ready
    wait $SERVER
fi
python scripts/load_test.py --base-url http://127.0.0.1:8100 --backdate "$@"
kill $SERVER
