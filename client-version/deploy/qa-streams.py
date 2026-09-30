"""Regression: open streams must not exhaust the PostgreSQL connection pool.

Run only against qa-start's isolated instance, after forwarding port 8120 to 8312.
"""
import asyncio
import json
import time
import httpx

BASE = "http://127.0.0.1:8312"


async def main():
    streams = []
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
        login = await client.post("/api/auth/login", json={
            "email": "admin@relay.demo", "password": "isolated-rigorous-qa-2026", "native": True,
        })
        login.raise_for_status()
        headers = {"Authorization": "Bearer " + login.json()["access_token"]}
        try:
            for _ in range(24):
                context = client.stream("GET", "/api/events/stream", headers=headers)
                response = await context.__aenter__()
                streams.append(context)
                response.raise_for_status()
                first = await anext(response.aiter_lines())
                assert first == "event: connected", first
            start = time.monotonic()
            health, dashboard = await asyncio.gather(
                client.get("/api/health"), client.get("/api/dashboard", headers=headers),
            )
            health.raise_for_status()
            dashboard.raise_for_status()
            elapsed = time.monotonic() - start
            assert elapsed < 5, elapsed
            print(json.dumps({"streams": len(streams), "health": health.status_code,
                              "dashboard": dashboard.status_code, "seconds": round(elapsed, 3)}))
        finally:
            for context in streams:
                await context.__aexit__(None, None, None)


if __name__ == "__main__":
    asyncio.run(main())
