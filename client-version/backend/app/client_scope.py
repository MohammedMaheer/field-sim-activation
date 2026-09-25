"""Proposal API surface, including narrowly scoped agent administration."""

from fastapi.routing import APIRoute
from fastapi import Request
from fastapi.responses import JSONResponse

RESOURCES = {
    "agents",
    "customers",
    "team-leaders",
    "outlets",
    "branches",
    "activations",
    "ekyc",
    "inventory",
    "movements",
    "compliance",
    "audit",
}
REPORTS = {"daily", "monthly", "agent", "team", "ekyc", "branch", "inventory", "failed", "audit"}
PATHS = {
    "/api/health",
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/dashboard",
    "/api/resources/{resource}",
    "/api/activations/{order_id}",
    "/api/agents/{agent_id}/shift",
    "/api/agents/{agent_id}/ping",
    "/api/agents/{agent_id}/management",
    "/api/inventory/{sim_id}/move",
    "/api/compliance/{alert_id}",
    "/api/events",
    "/api/events/stream",
    "/api/reports/{report}",
}


def configure(app):
    app.router.routes[:] = [
        r
        for r in app.router.routes
        if not isinstance(r, APIRoute)
        or r.path in PATHS
        or r.path.startswith(
            ("/api/organization", "/api/kyc-captures", "/api/field-tasks", "/api/incentives", "/api/support-tickets")
        )
    ]
    app.title = "Relay Client — Field Operations Concept"

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        path = request.url.path
        if path.startswith("/api/resources/") and path.rsplit("/", 1)[-1] not in RESOURCES:
            return JSONResponse({"detail": "Not included in this client edition"}, status_code=404)
        if path.startswith("/api/reports/"):
            report = path.rsplit("/", 1)[-1]
            if report not in REPORTS:
                return JSONResponse(
                    {"detail": "Report not included in this edition"},
                    status_code=404,
                )
        return await call_next(request)
