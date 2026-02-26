from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(title="Autopilot Ops Health", version="1.0.0")


@app.get("/")
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "autopilot-ops-py"}
