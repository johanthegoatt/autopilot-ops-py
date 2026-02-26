from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Iterable, List


@dataclass(frozen=True)
class TaskSignal:
    project: str
    task: str
    impact: float
    urgency: float
    confidence: float
    effort: float


REQUIRED_FIELDS = ("project", "task", "impact", "urgency", "confidence", "effort")
VALID_STRATEGIES = ("balanced", "impact", "urgency")


def _clamp_confidence(value: float) -> float:
    return min(max(value, 0.0), 1.0)


def _normalized_effort(value: float) -> float:
    return max(value, 0.25)


def leverage_score(task: TaskSignal, strategy: str = "balanced") -> float:
    effort = _normalized_effort(task.effort)
    confidence = _clamp_confidence(task.confidence)
    if strategy == "impact":
        weighted = (task.impact * 2.2) + (task.urgency * 0.8)
    elif strategy == "urgency":
        weighted = (task.impact * 1.2) + (task.urgency * 2.0)
    else:
        weighted = (task.impact * 1.8) + (task.urgency * 1.2)
    return weighted * confidence / effort


def rank_tasks(tasks: Iterable[TaskSignal], strategy: str = "balanced") -> List[TaskSignal]:
    return sorted(
        tasks,
        key=lambda task: (
            -leverage_score(task, strategy=strategy),
            -task.impact,
            -task.urgency,
            task.project.lower(),
            task.task.lower(),
        ),
    )


def filter_ranked_tasks(
    tasks: Iterable[TaskSignal], min_score: float = 0.0, top: int = 0, strategy: str = "balanced"
) -> List[TaskSignal]:
    selected = [task for task in tasks if leverage_score(task, strategy=strategy) >= min_score]
    if top > 0:
        return selected[:top]
    return selected


def build_weekly_plan(
    tasks: Iterable[TaskSignal], effort_budget: float, strategy: str = "balanced"
) -> List[TaskSignal]:
    ranked = rank_tasks(tasks, strategy=strategy)
    selected: List[TaskSignal] = []
    used_effort = 0.0
    safe_budget = max(effort_budget, 0.0)
    for task in ranked:
        effort = _normalized_effort(task.effort)
        if used_effort + effort > safe_budget:
            continue
        selected.append(task)
        used_effort += effort
    return selected


def _require(item: dict, field: str, index: int) -> object:
    if field not in item:
        raise ValueError(f"Task at index {index} is missing required field '{field}'.")
    return item[field]


def parse_tasks(path: Path) -> List[TaskSignal]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return parse_task_payload(raw)


def parse_task_payload(raw: object) -> List[TaskSignal]:
    if not isinstance(raw, list):
        raise ValueError("Task input must be a JSON array.")

    result: List[TaskSignal] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"Task at index {index} must be an object.")

        for field in REQUIRED_FIELDS:
            _require(item, field, index)

        result.append(
            TaskSignal(
                project=str(item["project"]).strip(),
                task=str(item["task"]).strip(),
                impact=float(item["impact"]),
                urgency=float(item["urgency"]),
                confidence=float(item["confidence"]),
                effort=float(item["effort"]),
            )
        )

    if not result:
        raise ValueError("Task input is empty.")

    return result


def build_plan_payload(
    tasks: Iterable[TaskSignal],
    effort_budget: float,
    top: int = 0,
    min_score: float = 0.0,
    strategy: str = "balanced",
) -> Dict[str, Any]:
    if strategy not in VALID_STRATEGIES:
        raise ValueError(f"Unknown strategy '{strategy}'. Valid strategies: {', '.join(VALID_STRATEGIES)}")

    ranked = rank_tasks(tasks, strategy=strategy)
    filtered = filter_ranked_tasks(
        ranked, min_score=min_score, top=top, strategy=strategy
    )
    weekly_plan = build_weekly_plan(filtered, effort_budget, strategy=strategy)

    return {
        "budget": effort_budget,
        "filters": {"top": top, "minScore": min_score, "strategy": strategy},
        "ranked": [
            {**asdict(task), "score": round(leverage_score(task, strategy=strategy), 4)}
            for task in filtered
        ],
        "weeklyPlan": [
            {**asdict(task), "score": round(leverage_score(task, strategy=strategy), 4)}
            for task in weekly_plan
        ],
        "usedEffort": round(sum(task.effort for task in weekly_plan), 2),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a high-leverage weekly engineering plan.")
    parser.add_argument("--input", required=True, help="Path to task signal JSON file")
    parser.add_argument("--budget", type=float, default=20.0, help="Max effort budget")
    parser.add_argument("--output", default="", help="Optional output JSON file")
    parser.add_argument("--top", type=int, default=0, help="Keep only top N ranked tasks (0 keeps all)")
    parser.add_argument("--min-score", type=float, default=0.0, help="Drop tasks scoring below this threshold")
    parser.add_argument(
        "--strategy",
        default="balanced",
        choices=VALID_STRATEGIES,
        help="Scoring strategy: balanced, impact, or urgency",
    )
    args = parser.parse_args()

    tasks = parse_tasks(Path(args.input))
    payload = build_plan_payload(
        tasks,
        effort_budget=args.budget,
        top=args.top,
        min_score=args.min_score,
        strategy=args.strategy,
    )

    text = json.dumps(payload, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
        print(f"Plan written to {args.output}")
    else:
        print(text)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
