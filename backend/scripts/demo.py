"""End-to-end demo scenario against a running API.

    docker compose exec api python scripts/demo.py            # inside the api container
    python scripts/demo.py --base-url http://localhost:8000   # from the host (needs httpx + websockets)

Steps:
 1. reset the simulation, create a citizen in Yasamal, route them to the nearest park
 2. close a road on that route                -> automatic reroute (road_closed)
 3. raise the citizen's target point to 91 %  -> automatic reroute (point_full)
 4. SOS burst: 4 distinct citizens within 400 m in 2 minutes -> RED ALERT
 5. dispatcher confirms the alert (brigade dispatched, reserve point opened, citizens rerouted)
Live WebSocket events for the dispatcher and the citizen are printed as they arrive.
"""
import argparse
import asyncio
import json
import math
import uuid

import httpx

try:
    import websockets
except ImportError:  # demo still works without live events
    websockets = None

START = (40.4060, 49.7990)  # north Yasamal


def banner(text: str) -> None:
    print(f"\n{'=' * 78}\n {text}\n{'=' * 78}")


def check(r: httpx.Response) -> dict | list:
    if r.status_code >= 400:
        raise SystemExit(f"HTTP {r.status_code} {r.request.method} {r.request.url}: {r.text}")
    return r.json()


async def listen(url: str, label: str, stop: asyncio.Event) -> None:
    if websockets is None:
        return
    try:
        async with websockets.connect(url) as ws:
            while not stop.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                msg = json.loads(raw)
                if msg["type"] in ("ping", "pong", "connected"):
                    continue
                d = msg["data"]
                extra = ""
                if msg["type"] == "route.rerouted":
                    extra = (f"reason={d.get('reason')} count={d['count']}" if "count" in d else
                             f"reason={d['reason']} eta {d['old_route']['eta_min'] if d['old_route'] else '-'}"
                             f" -> {d['new_route']['eta_min']} min (diff {d['eta_diff_min']})")
                elif msg["type"] in ("alert.raised", "alert.updated", "alert.resolved"):
                    extra = f"alert #{d['id']} {d['kind']} status={d['status']} citizens={d['distinct_citizens']}"
                elif msg["type"] == "brigade.updated":
                    extra = f"{d['name']} status={d['status']} @({d['lat']:.4f},{d['lng']:.4f})"
                elif msg["type"] == "point.occupancy":
                    extra = f"{d['name']} {d['occupancy_pct']}% status={d['status']}"
                elif msg["type"] in ("sos.created", "sos.updated"):
                    extra = f"sos #{d['id']} status={d.get('status')} priority={d.get('priority_score')}"
                elif msg["type"] == "road.updated":
                    extra = f"segments={[s['id'] for s in d['segments']]} status={d['segments'][0]['status']}"
                print(f"   [ws:{label}] {msg['type']:<16} {extra}")
    except Exception as exc:  # noqa: BLE001
        print(f"   [ws:{label}] closed: {exc!r}")


async def main(base: str) -> None:
    api = f"{base}/api/v1"
    ws_base = base.replace("http", "ws", 1)
    stop = asyncio.Event()
    async with httpx.AsyncClient(timeout=60) as c:
        banner("0. Dispatcher login + reset simulation")
        token = check(await c.post(f"{api}/auth/login", json={"username": "admin", "password": "admin123"}))["access_token"]
        admin = {"Authorization": f"Bearer {token}"}
        check(await c.post(f"{api}/sim/reset", headers=admin))
        print("   state restored to seed baseline")

        banner("1. Citizen in Yasamal -> route to the nearest park")
        device = str(uuid.uuid4())
        me = {"X-Device-Id": device}
        check(await c.post(f"{api}/citizens/register", json={"device_id": device}))
        citizen = check(await c.patch(f"{api}/citizens/me/location", json={"lat": START[0], "lng": START[1]}, headers=me))
        zones = {z["id"]: z["name"] for z in check(await c.get(f"{api}/zones"))}
        print(f"   citizen {citizen['id']} in zone {zones.get(citizen['zone_id'])}")

        tasks = [asyncio.create_task(listen(f"{ws_base}/ws/dispatch?token={token}", "dispatch", stop)),
                 asyncio.create_task(listen(f"{ws_base}/ws/citizen?device_id={device}", "citizen", stop))]
        await asyncio.sleep(0.5)

        nearest = check(await c.get(f"{api}/assembly-points/nearest",
                                    params={"lat": START[0], "lng": START[1], "zone_id": citizen["zone_id"], "limit": 20}))
        park = next(i for i in nearest if i["point"]["type"] == "park")
        print(f"   nearest park: {park['point']['name']} ({park['distance_m']:.0f} m, {park['eta_min']} min walk, "
              f"{park['point']['occupancy_pct']}% full)")
        route = check(await c.post(f"{api}/citizens/me/route", headers=me,
                                   json={"point_id": park["point"]["id"], "lat": START[0], "lng": START[1]}))
        print(f"   route v{route['version']}: {route['distance_m']:.0f} m, ETA {route['eta_min']} min")

        banner("2. Close a road on that route -> automatic reroute")
        coords = route["geometry"]["coordinates"]
        mid = len(coords) // 2
        (x1, y1), (x2, y2) = coords[mid], coords[mid + 1]
        closure = check(await c.post(f"{api}/sim/road-closure", headers=admin, json={
            "lat": (y1 + y2) / 2, "lng": (x1 + x2) / 2, "status": "closed", "reason": "Zəlzələ: bina uçqunu"}))
        print(f"   closed segments {closure['segment_ids']}, rerouted citizens: {closure['rerouted']}")
        await asyncio.sleep(0.5)
        route = check(await c.get(f"{api}/citizens/me/route", headers=me))
        print(f"   active route v{route['version']} reason={route['reason']} ETA {route['eta_min']} min")

        banner("3. Raise the citizen's target point to 91% -> automatic reroute")
        target = next(p for p in check(await c.get(f"{api}/assembly-points")) if p["id"] == route["target_point_id"])
        occ = check(await c.post(f"{api}/sim/occupancy", headers=admin, json={
            "point_id": target["id"], "current_count": math.ceil(target["capacity"] * 0.91)}))
        print(f"   {target['name']} now {occ['point']['occupancy_pct']}%, rerouted citizens: {occ['rerouted']}")
        await asyncio.sleep(0.5)
        route = check(await c.get(f"{api}/citizens/me/route", headers=me))
        print(f"   active route v{route['version']} reason={route['reason']} -> point #{route['target_point_id']}")

        banner("4. SOS burst: 4 distinct citizens within 400 m in 2 minutes -> RED ALERT")
        burst = check(await c.post(f"{api}/sim/sos-burst", headers=admin, json={
            "lat": START[0], "lng": START[1], "count": 4, "radius_m": 400, "window_sec": 120, "type": "collapse"}))
        print(f"   SOS ids {burst['sos_ids']} -> alerts {burst['alert_ids']}")
        await asyncio.sleep(0.5)
        alert = check(await c.get(f"{api}/alerts", params={"status": "active"}, headers=admin))[0]
        rb, rp = alert["recommended_brigade"], alert["recommended_new_point"]
        print(f"   RED ALERT #{alert['id']} {alert['kind']} zone={alert['zone_name']} "
              f"distinct citizens={alert['distinct_citizens']}")
        if rb:
            print(f"   recommended brigade: {rb['name']} ({rb['type']}), ETA {rb['eta_min']} min")
        if rp:
            print(f"   recommended reserve point: {rp['name']} (capacity {rp['capacity']}, {rp['distance_m']:.0f} m)")

        banner("5. Dispatcher confirms the alert (one click)")
        confirmed = check(await c.post(f"{api}/alerts/{alert['id']}/confirm", headers=admin, json={}))
        print(f"   alert status: {confirmed['status']}")
        route = check(await c.get(f"{api}/citizens/me/route", headers=me))
        print(f"   citizen route v{route['version']} reason={route['reason']} -> point #{route['target_point_id']}")
        print("   watching brigade movement for 6 s ...")
        await asyncio.sleep(6)
        overview = check(await c.get(f"{api}/dispatch/overview", headers=admin))
        print(f"   overview: {json.dumps(overview, ensure_ascii=False)}")

        stop.set()
        await asyncio.gather(*tasks)
    banner("Demo finished")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    asyncio.run(main(parser.parse_args().base_url))
