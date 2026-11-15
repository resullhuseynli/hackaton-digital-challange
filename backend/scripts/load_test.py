"""SOS flood / spam-attack load test over real HTTP.

Fires everything at once (asyncio.gather):
  * bot farm  : FARM_SOS SOS from ONE IP with fresh devices (registration itself is rate limited)
  * botnet    : BOTNET_SOS SOS from BOTNET_SOS/2 IPs, 2 fresh devices each (only flood mode catches it)
  * citizens  : LEGIT established devices (registered > 10 min ago) sending real SOS from distinct IPs
  * panel     : dispatcher reads (SOS queue + overview) during the attack
and reports status codes and latency (avg / p50 / p95 / p99 / max) per group, plus what the dispatcher
panel shows afterwards (real SOS in the queue vs quarantined bot SOS).

Client IPs are simulated with X-Forwarded-For, which uvicorn trusts only from 127.0.0.1 - so run this
next to the server (e.g. inside the api container). `--backdate` ages the legit devices directly in the
DB (needs DATABASE_URL), because device age is one of the anti-spam signals.

    python scripts/load_test.py --base-url http://127.0.0.1:8000 --backdate
"""
import argparse
import asyncio
import json
import multiprocessing as mp
import random
import statistics
import time
import uuid
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor

import httpx

API = "/api/v1"


def ip(a: int, b: int) -> str:
    return f"100.{64 + a // 250}.{a % 250}.{b}"


def run_chunk(base_url: str, jobs: list, start_at: float) -> list:
    """Client process: fire all of its jobs concurrently at `start_at` (wall clock)."""
    async def go():
        limits = httpx.Limits(max_connections=len(jobs) + 10, max_keepalive_connections=len(jobs) + 10)
        async with httpx.AsyncClient(base_url=base_url, timeout=60, limits=limits) as c:
            await asyncio.sleep(max(0.0, start_at - time.time()))

            async def one(job):
                method, path, body, headers, group, delay = job
                if delay:
                    await asyncio.sleep(delay)
                t0 = time.perf_counter()
                r = await c.request(method, path, json=body, headers=headers)
                dt = time.perf_counter() - t0
                timing = r.headers.get("server-timing", "")
                server_ms = float(timing.split("dur=")[1]) if "dur=" in timing else -1.0
                return group, r.status_code, dt, server_ms, time.time()

            return await asyncio.gather(*(one(j) for j in jobs))
    return asyncio.run(go())


def pct(values: list[float], p: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))]


async def backdate(device_ids: list[str]) -> None:
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import update

    from app.db import SessionLocal, engine
    from app.models import Citizen
    async with SessionLocal() as s:
        await s.execute(update(Citizen).where(Citizen.device_id.in_(device_ids))
                        .values(created_at=datetime.now(timezone.utc) - timedelta(hours=2)))
        await s.commit()
    await engine.dispose()


async def baseline(a) -> None:
    """Same burst shape against GET /health (≈ zero server work): the load generator + TCP floor."""
    n = a.farm + a.botnet + a.legit + a.panel * 2
    jobs = [("GET", "/health", None, {}, "baseline", 0.0) for _ in range(n)]
    chunks = [jobs[i::a.procs] for i in range(a.procs)]
    start_at = time.time() + 3
    loop = asyncio.get_running_loop()
    with ProcessPoolExecutor(max_workers=a.procs, mp_context=mp.get_context("spawn")) as pool:
        parts = await asyncio.gather(*(loop.run_in_executor(pool, run_chunk, a.base_url, ch, start_at)
                                       for ch in chunks))
    lat = [r[2] * 1000 for part in parts for r in part]
    srv = [r[3] for part in parts for r in part if r[3] >= 0]
    print(f"baseline GET /health x{n} at once: client avg {statistics.mean(lat):.1f} ms "
          f"(p50 {pct(lat, 50):.1f}, p95 {pct(lat, 95):.1f}), server avg {statistics.mean(srv):.2f} ms")


async def report(a) -> None:
    """Print the k6 burst results and what the dispatcher panel shows afterwards."""
    with open(a.report, encoding="utf-8") as f:
        prep = json.load(f)
    with open(a.k6_summary, encoding="utf-8") as f:
        k6 = json.load(f)["metrics"]
    n = len(prep["jobs"])
    print(f"\nk6 burst: {n} requests, one per virtual user, all started at once\n")
    for title, prefix in (("client-observed latency (ms): connect + send + wait + receive", "lat_"),
                          ("server-side processing (ms, Server-Timing header)", "srv_")):
        print(title)
        print(f"{'group':<10} {'n':>5}  {'status codes':<34} {'avg':>7} {'p50':>7} {'p95':>7} {'p99':>7} {'max':>7}")
        for g in ("bot_farm", "botnet", "citizens", "panel", "all"):
            m = k6.get(f"{prefix}{g}")
            if not m:
                continue
            v = m["values"]
            codes = {c: int(k6[f"st_{g}_{c}"]["values"]["count"]) for c in (200, 201, 401, 429, 500)
                     if f"st_{g}_{c}" in k6 and k6[f"st_{g}_{c}"]["values"]["count"]}
            cnt = sum(codes.values()) if g != "all" else n
            label = "ALL" if g == "all" else g
            print(f"{label:<10} {cnt:>5}  {str(codes) if g != 'all' else '':<34} "
                  f"{v['avg']:7.1f} {v['med']:7.1f} {v['p(95)']:7.1f} {v['p(99)']:7.1f} {v['max']:7.1f}")
        print()
    async with httpx.AsyncClient(base_url=a.base_url, timeout=60) as c:
        admin = prep["admin"]
        queue = (await c.get(f"{API}/sos", headers=admin, params={"limit": 1000})).json()
        quarantined = (await c.get(f"{API}/sos", headers=admin,
                                   params={"suspected_only": "true", "limit": 1000})).json()
        ov = (await c.get(f"{API}/dispatch/overview", headers=admin)).json()
        legit_ids = set()
        for d in prep["legit_devices"]:
            legit_ids |= {s["id"] for s in (await c.get(f"{API}/sos/me", headers={"X-Device-Id": d})).json()}
    queue_ids = {s["id"] for s in queue}
    print(f"dispatcher queue: {len(queue)} SOS ({len(legit_ids & queue_ids)}/{len(legit_ids)} real citizens' "
          f"SOS present)")
    print(f"quarantined for review: {len(quarantined)} | reasons: "
          f"{dict(Counter(s['suspicion_reason'] for s in quarantined))}")
    print(f"overview: active_sos={ov['active_sos']} suspected_sos={ov['suspected_sos']} "
          f"citizens_in_danger={ov['citizens_in_danger']} active_alerts={ov['active_alerts']}")
    avg, srv = k6["lat_all"]["values"]["avg"], k6["srv_all"]["values"]["avg"]
    print(f"\nRESULT: average latency {avg:.1f} ms client-observed (k6), {srv:.1f} ms server-side -> "
          f"{'PASS' if avg < 300 else 'FAIL'} (target < 300 ms)")


async def main(a) -> None:
    if a.baseline:
        await baseline(a)
        return
    if a.report:
        await report(a)
        return
    rnd = random.Random(7)
    limits = httpx.Limits(max_connections=2000, max_keepalive_connections=2000)
    async with httpx.AsyncClient(base_url=a.base_url, timeout=60, limits=limits) as c:
        tok = (await c.post(f"{API}/auth/login", json={"username": "admin", "password": "admin123"})).json()
        admin = {"Authorization": f"Bearer {tok['access_token']}"}
        assert (await c.post(f"{API}/sim/reset", headers=admin)).status_code == 200

        async def register(device: str, addr: str) -> int:
            r = await c.post(f"{API}/citizens/register", json={"device_id": device},
                             headers={"X-Forwarded-For": addr})
            return r.status_code

        # --- preparation (not part of the measured burst) -------------------------------------
        legit = [(str(uuid.uuid4()), ip(200, i)) for i in range(a.legit)]
        await asyncio.gather(*(register(d, addr) for d, addr in legit))
        if a.backdate:
            await backdate([d for d, _ in legit])
        farm_ip = "100.99.99.99"
        farm = [(str(uuid.uuid4()), farm_ip) for _ in range(a.farm)]
        farm_reg = Counter(await asyncio.gather(*(register(d, farm_ip) for d, _ in farm)))
        botnet = [(str(uuid.uuid4()), ip(i // 2, 1)) for i in range(a.botnet)]
        botnet_reg = Counter(await asyncio.gather(*(register(d, addr) for d, addr in botnet)))
        print(f"registration: bot farm {dict(farm_reg)} | botnet {dict(botnet_reg)} | legit {len(legit)}")
        await asyncio.sleep(1)

        # --- the burst: jobs spread over client processes that all start at the same instant -------
        center = (40.3960, 49.7950)

        def sos_job(group: str, device: str, addr: str, spread: float):
            body = {"type": rnd.choice(["collapse", "fire", "medical", "flood"]),
                    "lat": center[0] + rnd.uniform(-spread, spread), "lng": center[1] + rnd.uniform(-spread, spread)}
            return ("POST", f"{API}/sos", body, {"X-Device-Id": device, "X-Forwarded-For": addr}, group, 0.0)

        jobs = ([sos_job("bot_farm", d, addr, 0.004) for d, addr in farm]
                + [sos_job("botnet", d, addr, 0.01) for d, addr in botnet]
                + [sos_job("citizens", d, addr, 0.03) for d, addr in legit]
                + [("GET", f"{API}{p}", None, admin, "panel", i * 0.05)
                   for i in range(a.panel) for p in ("/sos", "/dispatch/overview")])
        rnd.shuffle(jobs)
        if a.prepare_out:  # hand the burst to an external generator (k6), see scripts/k6_burst.js
            with open(a.prepare_out, "w", encoding="utf-8") as f:
                json.dump({"jobs": [{"method": m, "path": p, "body": b, "headers": h, "group": g, "delay": d}
                                    for m, p, b, h, g, d in jobs],
                           "legit_devices": [d for d, _ in legit], "admin": admin}, f)
            print(f"prepared {len(jobs)} jobs -> {a.prepare_out}")
            return
        chunks = [jobs[i::a.procs] for i in range(a.procs)]
        start_at = time.time() + 3
        loop = asyncio.get_running_loop()
        with ProcessPoolExecutor(max_workers=a.procs, mp_context=mp.get_context("spawn")) as pool:
            futures = [loop.run_in_executor(pool, run_chunk, a.base_url, chunk, start_at) for chunk in chunks]
            parts = await asyncio.gather(*futures)
        rows_all = [r for part in parts for r in part]
        wall = max(r[4] for r in rows_all) - start_at
        results: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
        for group, status, client_s, server_ms, _end in rows_all:
            results[group].append((status, client_s * 1000, server_ms))

        # --- report -----------------------------------------------------------------------------
        n = len(rows_all)
        print(f"\nburst: {n} requests from {a.procs} client processes, all started at once; "
              f"finished in {wall:.2f}s ({n / wall:.0f} req/s)\n")
        hdr = f"{'group':<10} {'n':>5}  {'status codes':<34} {'avg':>7} {'p50':>7} {'p95':>7} {'p99':>7} {'max':>7}"
        all_client, all_server = [], []
        for title, idx in (("client-observed latency (ms): network + queueing + server", 1),
                           ("server-side processing (ms, Server-Timing header)", 2)):
            print(title)
            print(hdr)
            pooled = []
            for group in ("bot_farm", "botnet", "citizens", "panel"):
                rows = results[group]
                lat = [x[idx] for x in rows if x[idx] >= 0]
                if not lat:
                    continue
                pooled += lat
                codes = dict(sorted(Counter(x[0] for x in rows).items()))
                print(f"{group:<10} {len(rows):>5}  {str(codes):<34} {statistics.mean(lat):7.1f} {pct(lat, 50):7.1f} "
                      f"{pct(lat, 95):7.1f} {pct(lat, 99):7.1f} {max(lat):7.1f}")
            print(f"{'ALL':<10} {len(pooled):>5}  {'':<34} {statistics.mean(pooled):7.1f} {pct(pooled, 50):7.1f} "
                  f"{pct(pooled, 95):7.1f} {pct(pooled, 99):7.1f} {max(pooled):7.1f}\n")
            (all_client if idx == 1 else all_server).extend(pooled)
        all_lat = all_client

        queue = (await c.get(f"{API}/sos", headers=admin, params={"limit": 1000})).json()
        quarantined = (await c.get(f"{API}/sos", headers=admin, params={"suspected_only": "true", "limit": 1000})).json()
        ov = (await c.get(f"{API}/dispatch/overview", headers=admin)).json()
        legit_ids = set()
        for d, _ in legit:
            mine = (await c.get(f"{API}/sos/me", headers={"X-Device-Id": d})).json()
            legit_ids |= {s["id"] for s in mine}
        queue_ids = {s["id"] for s in queue}
        print(f"\ndispatcher queue: {len(queue)} SOS ({len(legit_ids & queue_ids)}/{len(legit_ids)} real citizens' SOS present)")
        print(f"quarantined for review: {len(quarantined)} | reasons: "
              f"{dict(Counter(s['suspicion_reason'] for s in quarantined))}")
        print(f"overview: active_sos={ov['active_sos']} suspected_sos={ov['suspected_sos']} "
              f"citizens_in_danger={ov['citizens_in_danger']} active_alerts={ov['active_alerts']}")
        avg, srv = statistics.mean(all_lat), statistics.mean(all_server)
        print(f"\nRESULT: average latency {avg:.1f} ms client-observed, {srv:.1f} ms server-side -> "
              f"{'PASS' if avg < 300 else 'FAIL'} (target < 300 ms)")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--base-url", default="http://127.0.0.1:8000")
    p.add_argument("--farm", type=int, default=300, help="SOS from the single-IP bot farm")
    p.add_argument("--botnet", type=int, default=300, help="SOS from the distributed botnet (2 per IP)")
    p.add_argument("--legit", type=int, default=50, help="real citizens sending SOS during the attack")
    p.add_argument("--panel", type=int, default=20, help="dispatcher read rounds during the attack")
    p.add_argument("--backdate", action="store_true", help="age legit devices in the DB (needs DATABASE_URL)")
    p.add_argument("--baseline", action="store_true", help="only measure the generator/TCP floor via GET /health")
    p.add_argument("--prepare-out", help="prepare and write the burst as JSON for k6 instead of firing it")
    p.add_argument("--report", help="prepared JSON file: print k6 results + dispatcher outcome")
    p.add_argument("--k6-summary", default="scripts/.lt_k6.json")
    p.add_argument("--procs", type=int, default=8, help="client processes (one Python loop can't open 600 "
                                                         "connections at once without becoming the bottleneck)")
    asyncio.run(main(p.parse_args()))
