from __future__ import annotations

from typing import List, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from src.autopilot_ops import build_plan_payload, parse_task_payload


class TaskInput(BaseModel):
    project: str = Field(min_length=1)
    task: str = Field(min_length=1)
    impact: float
    urgency: float
    confidence: float
    effort: float

    model_config = {"extra": "forbid"}


class PlanRequest(BaseModel):
    tasks: List[TaskInput] = Field(min_length=1)
    budget: float = 20.0
    top: int = Field(default=0, ge=0)
    minScore: float = 0.0
    strategy: Literal["balanced", "impact", "urgency"] = "balanced"
    packing: Literal["optimal", "greedy"] = "optimal"
    weeks: int = Field(default=1, ge=1, le=52)

    model_config = {"extra": "forbid"}


app = FastAPI(title="Autopilot Ops API", version="1.0.0")


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={
            "error": "Invalid request payload.",
            "details": exc.errors(),
        },
    )


@app.post("/")
@app.post("/api/plan")
def generate_plan(payload: PlanRequest):
    try:
        tasks = parse_task_payload([task.model_dump() for task in payload.tasks])
        return build_plan_payload(
            tasks,
            effort_budget=payload.budget,
            top=payload.top,
            min_score=payload.minScore,
            strategy=payload.strategy,
            packing=payload.packing,
            weeks=payload.weeks,
        )
    except ValueError as error:
        return JSONResponse(status_code=400, content={"error": str(error)})
