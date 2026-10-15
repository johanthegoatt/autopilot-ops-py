from __future__ import annotations

import argparse
import json
import math
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
VALID_PACKINGS = ("optimal", "greedy")


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


def task_value(task: TaskSignal, strategy: str = "balanced") -> float:
    """What finishing the task is worth: the score before it is divided by effort."""
    return leverage_score(task, strategy=strategy) * _normalized_effort(task.effort)


# Efforts are packed on a grid of hundredths, rounded up so a plan can never
# overrun the budget. Past this many table cells the exact packer would get
# slow in Python, so it falls back to greedy and says so in the payload.
EFFORT_STEP = 0.01
MAX_DP_CELLS = 1_000_000


def _units(effort: float) -> int:
    return int(math.ceil(effort / EFFORT_STEP - 1e-9))


def _capacity(effort_budget: float) -> int:
    return int(math.floor(max(effort_budget, 0.0) / EFFORT_STEP + 1e-9))


def _greedy_plan(ranked: List[TaskSignal], effort_budget: float) -> List[TaskSignal]:
    selected: List[TaskSignal] = []
    used_effort = 0.0
    for task in ranked:
        effort = _normalized_effort(task.effort)
        if used_effort + effort > effort_budget:
            continue
        selected.append(task)
        used_effort += effort
    return selected


def _optimal_plan(ranked: List[TaskSignal], effort_budget: float, strategy: str) -> List[TaskSignal]:
    # 0/1 knapsack by dynamic programming: best[c] is the most value that fits
    # in c units of effort. keep[i] records which capacities took task i, so
    # the chosen set can be read back from the last task to the first.
    capacity = _capacity(effort_budget)
    best = [0.0] * (capacity + 1)
    keep: List[bytearray] = []
    for task in ranked:
        weight = _units(_normalized_effort(task.effort))
        value = task_value(task, strategy)
        took = bytearray(capacity + 1)
        for c in range(capacity, weight - 1, -1):
            candidate = best[c - weight] + value
            # Only a strictly better total replaces the current one, so equal
            # plans resolve the same way on every run and in the browser port.
            if candidate > best[c] + 1e-9:
                best[c] = candidate
                took[c] = 1
        keep.append(took)

    chosen: List[TaskSignal] = []
    c = capacity
    for index in range(len(ranked) - 1, -1, -1):
        if keep[index][c]:
            chosen.append(ranked[index])
            c -= _units(_normalized_effort(ranked[index].effort))
    chosen.reverse()
    return chosen


def plan_packing(task_count: int, effort_budget: float, packing: str = "optimal") -> str:
    """Which packer will run: optimal unless greedy was asked for or the table is too big."""
    if packing not in VALID_PACKINGS:
        raise ValueError(f"Unknown packing '{packing}'. Valid packings: {', '.join(VALID_PACKINGS)}")
    if packing == "greedy":
        return "greedy"
    cells = task_count * (_capacity(effort_budget) + 1)
    return "optimal" if cells <= MAX_DP_CELLS else "greedy"


def build_weekly_plan(
    tasks: Iterable[TaskSignal],
    effort_budget: float,
    strategy: str = "balanced",
    packing: str = "optimal",
) -> List[TaskSignal]:
    """Pick the tasks that fit the budget, returned in rank order.

    Taking tasks in score order (the old behaviour) is Dantzig's 1957 greedy
    rule and can leave value on the table: with 10 hours, one 6 hour task
    worth 1.17 an hour goes first, but two 5 hour tasks worth 1.10 an hour
    are worth 11 together against 7. The optimal packer maximises the total.
    """
    ranked = rank_tasks(tasks, strategy=strategy)
    safe_budget = max(effort_budget, 0.0)
    if plan_packing(len(ranked), safe_budget, packing) == "greedy":
        return _greedy_plan(ranked, safe_budget)
    return _optimal_plan(ranked, safe_budget, strategy)


def _require(item: dict, field: str, index: int) -> object:
    if field not in item:
        raise ValueError(f"Task at index {index} is missing required field '{field}'.")
    return item[field]


def _number(item: dict, field: str, index: int) -> float:
    # float() accepts "nan" and "inf". A NaN score compares false against
    # everything, so one bad row silently scrambles the whole ranking.
    try:
        value = float(item[field])
    except (TypeError, ValueError):
        raise ValueError(f"Task at index {index}: '{field}' must be a number.") from None
    if not math.isfinite(value):
        raise ValueError(f"Task at index {index}: '{field}' must be a finite number.")
    if value < 0:
        raise ValueError(f"Task at index {index}: '{field}' cannot be negative.")
    return value


def _confidence(item: dict, index: int) -> float:
    # RICE writes confidence as a percentage (100%, 80%, 50%), so people type
    # 80 as often as 0.8. Up to 1 is a fraction, up to 100 is a percent.
    value = _number(item, "confidence", index)
    if value <= 1.0:
        return value
    if value <= 100.0:
        return value / 100.0
    raise ValueError(
        f"Task at index {index}: 'confidence' must be a fraction (0.8) or a percent (80)."
    )


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
                impact=_number(item, "impact", index),
                urgency=_number(item, "urgency", index),
                confidence=_confidence(item, index),
                effort=_number(item, "effort", index),
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
    packing: str = "optimal",
) -> Dict[str, Any]:
    if strategy not in VALID_STRATEGIES:
        raise ValueError(f"Unknown strategy '{strategy}'. Valid strategies: {', '.join(VALID_STRATEGIES)}")
    if not math.isfinite(effort_budget) or effort_budget < 0:
        raise ValueError("Budget must be a finite number of hours, 0 or more.")
    if not math.isfinite(min_score):
        raise ValueError("Minimum score must be a finite number.")
    if top < 0:
        raise ValueError("Top must be 0 (keep all) or a positive count.")

    ranked = rank_tasks(tasks, strategy=strategy)
    filtered = filter_ranked_tasks(
        ranked, min_score=min_score, top=top, strategy=strategy
    )
    packing_used = plan_packing(len(filtered), effort_budget, packing)
    weekly_plan = build_weekly_plan(filtered, effort_budget, strategy=strategy, packing=packing_used)

    return {
        "budget": effort_budget,
        "filters": {"top": top, "minScore": min_score, "strategy": strategy},
        "packing": packing_used,
        "ranked": [
            {**asdict(task), "score": round(leverage_score(task, strategy=strategy), 4)}
            for task in filtered
        ],
        "weeklyPlan": [
            {**asdict(task), "score": round(leverage_score(task, strategy=strategy), 4)}
            for task in weekly_plan
        ],
        # Count effort the way the packer did, floor included, or a plan of
        # zero-effort tasks reports 0 used while it has spent the budget.
        "usedEffort": round(sum(_normalized_effort(task.effort) for task in weekly_plan), 2),
        "planValue": round(sum(task_value(task, strategy) for task in weekly_plan), 4),
    }


def main(argv: List[str] | None = None) -> int:
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
    parser.add_argument(
        "--packing",
        default="optimal",
        choices=VALID_PACKINGS,
        help="optimal fits the most value into the budget, greedy takes tasks in score order",
    )
    args = parser.parse_args(argv)

    try:
        tasks = parse_tasks(Path(args.input))
        payload = build_plan_payload(
            tasks,
            effort_budget=args.budget,
            top=args.top,
            min_score=args.min_score,
            strategy=args.strategy,
            packing=args.packing,
        )
    except FileNotFoundError:
        parser.exit(2, f"error: input file not found: {args.input}\n")
    except json.JSONDecodeError as error:
        parser.exit(2, f"error: {args.input} is not valid JSON (line {error.lineno}, column {error.colno})\n")
    except ValueError as error:
        parser.exit(2, f"error: {error}\n")

    text = json.dumps(payload, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
        print(f"Plan written to {args.output}")
    else:
        print(text)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
