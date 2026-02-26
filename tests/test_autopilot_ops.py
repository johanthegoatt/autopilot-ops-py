import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from src.autopilot_ops import (
    TaskSignal,
    build_weekly_plan,
    filter_ranked_tasks,
    leverage_score,
    parse_tasks,
    rank_tasks,
)


class AutopilotOpsTests(unittest.TestCase):
    def setUp(self):
        self.tasks = [
            TaskSignal("portfolio", "hero polish", 9.0, 8.0, 0.9, 5.0),
            TaskSignal("vault", "key rotation", 8.5, 8.5, 0.8, 4.0),
            TaskSignal("router", "log cleanup", 5.0, 4.0, 1.0, 3.0),
        ]

    def test_leverage_score_prefers_high_impact_with_reasonable_effort(self):
        scores = [leverage_score(task) for task in self.tasks]
        self.assertGreater(scores[1], scores[2])

    def test_rank_tasks_returns_descending_order(self):
        ranked = rank_tasks(self.tasks)
        ordered_scores = [leverage_score(task) for task in ranked]
        self.assertEqual(ordered_scores, sorted(ordered_scores, reverse=True))

    def test_build_weekly_plan_respects_effort_budget(self):
        plan = build_weekly_plan(self.tasks, effort_budget=5.0)
        used_effort = sum(task.effort for task in plan)
        self.assertLessEqual(used_effort, 5.0)

    def test_filter_ranked_tasks_applies_threshold_and_top(self):
        ranked = rank_tasks(self.tasks)
        filtered = filter_ranked_tasks(ranked, min_score=3.5, top=1)
        self.assertEqual(len(filtered), 1)
        self.assertGreaterEqual(leverage_score(filtered[0]), 3.5)

    def test_leverage_score_clamps_confidence_and_effort(self):
        risky = TaskSignal("x", "y", 10.0, 10.0, 2.0, 0.0)
        score = leverage_score(risky)
        self.assertGreater(score, 0)
        self.assertAlmostEqual(score, 120.0)

    def test_parse_tasks_rejects_missing_fields(self):
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "bad.json"
            path.write_text('[{"project": "p", "task": "t"}]', encoding="utf-8")
            with self.assertRaises(ValueError):
                parse_tasks(path)

    def test_strategy_changes_scoring_priorities(self):
        impact_heavy = TaskSignal("proj", "impact", 10.0, 2.0, 1.0, 2.0)
        urgency_heavy = TaskSignal("proj", "urgency", 4.0, 10.0, 1.0, 2.0)

        impact_score = leverage_score(impact_heavy, strategy="impact")
        urgency_score = leverage_score(urgency_heavy, strategy="impact")
        self.assertGreater(impact_score, urgency_score)

        impact_score_urgency_mode = leverage_score(impact_heavy, strategy="urgency")
        urgency_score_urgency_mode = leverage_score(urgency_heavy, strategy="urgency")
        self.assertGreater(urgency_score_urgency_mode, impact_score_urgency_mode)


if __name__ == "__main__":
    unittest.main()
