"""Background worker process: crisis-queue consumers + periodic jobs, off the API event loops.

    python -m app.worker

In docker compose the `worker` service runs this, and the API workers are started with
CRISIS_CONSUMERS_PER_WORKER=0 / ENABLE_BACKGROUND_TASKS=false. Under an SOS flood the API processes
then only accept and store requests, while RED ALERT detection, priorities, recommendations and brigade
movement run here. It also follows the Redis bus to keep its in-memory road graph in sync with closures.
"""
import asyncio
import logging

from app.config import settings
from app.db import SessionLocal
from app.realtime.events import bus
from app.realtime.ws_manager import manager
from app.services import crisis_queue
from app.services.routing import graph

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app.worker")


async def load_graph_with_retry(attempts: int = 60) -> None:
    """The API container runs the migrations/seed; wait for the road graph to exist."""
    for i in range(attempts):
        try:
            async with SessionLocal() as session:
                await graph.load(session)
            if graph.g.number_of_nodes():
                return
        except Exception as exc:  # noqa: BLE001
            log.info("waiting for the database (%s)", exc.__class__.__name__)
        await asyncio.sleep(2)
    raise RuntimeError("road graph not available")


async def main() -> None:
    await bus.connect()
    await load_graph_with_retry()
    log.info("worker ready: graph %d nodes, %d crisis consumers, background jobs %s",
             graph.g.number_of_nodes(), settings.worker_consumers, settings.enable_background_tasks)
    coros = [bus.listen(manager.handle_bus_message)]  # graph sync (no sockets here)
    coros += [crisis_queue.consumer_loop() for _ in range(max(1, settings.worker_consumers))]
    if settings.enable_background_tasks:
        from app.services.jobs import background_coroutines
        coros += background_coroutines()
    await asyncio.gather(*coros)


if __name__ == "__main__":
    asyncio.run(main())
