"""Stand-in for the external map & routing API (OSRM-compatible subset) with fault injection.

    GET  /route/v1/{profile}/{lng},{lat};{lng},{lat}?overview=full&geometries=geojson
    POST /__fault  {"mode": "ok" | "error_503" | "timeout", "delay_sec": 8}
    GET  /__fault

It computes routes on the seeded road network loaded once at startup - like a real third-party
provider it knows nothing about live closures in our system. Demo/test use only.
"""
import asyncio
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services.routing import DRIVE, WALK, RoadGraph

graph = RoadGraph()
fault = {"mode": "ok", "delay_sec": 8.0}


async def ensure_graph() -> None:
    """(Re)load lazily: the mock may start before the API has seeded the database."""
    if graph.loaded and graph.g.number_of_nodes():
        return
    from app.db import SessionLocal
    async with SessionLocal() as session:
        await graph.load(session)
    graph.reset()  # pristine network: no closures, no barriers


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        await ensure_graph()
    except Exception:  # noqa: BLE001 - DB not ready yet; retried on first request
        pass
    yield


app = FastAPI(title="Mock external routing API", lifespan=lifespan)


class FaultIn(BaseModel):
    mode: Literal["ok", "error_503", "timeout"]
    delay_sec: float = Field(8.0, ge=0, le=60)


@app.post("/__fault")
async def set_fault(body: FaultIn):
    fault.update(body.model_dump())
    return fault


@app.get("/__fault")
async def get_fault():
    return fault


@app.get("/health")
async def health():
    return {"status": "ok" if fault["mode"] == "ok" else fault["mode"], "nodes": graph.g.number_of_nodes()}


@app.get("/route/v1/{profile}/{coords}")
async def route(profile: str, coords: str, overview: str = "full", geometries: str = "geojson"):
    if fault["mode"] == "error_503":
        return JSONResponse(status_code=503, content={"code": "ServiceUnavailable",
                                                      "message": "Routing service temporarily unavailable"})
    if fault["mode"] == "timeout":
        await asyncio.sleep(fault["delay_sec"])
    try:
        (lng1, lat1), (lng2, lat2) = [tuple(float(v) for v in p.split(",")) for p in coords.split(";")[:2]]
    except ValueError:
        return JSONResponse(status_code=400, content={"code": "InvalidQuery", "message": "bad coordinates"})
    await ensure_graph()
    mode = DRIVE if profile in ("driving", "car") else WALK
    r = graph.route(lat1, lng1, lat2, lng2, mode)
    if r is None:
        return JSONResponse(status_code=400, content={"code": "NoRoute", "message": "No route found"})
    return {"code": "Ok", "routes": [{"distance": r.distance_m, "duration": r.duration_s,
                                      "geometry": {"type": "LineString", "coordinates": [list(c) for c in r.coords]}}],
            "waypoints": [{"location": [lng1, lat1]}, {"location": [lng2, lat2]}]}
