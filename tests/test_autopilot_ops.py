import contextlib
import io
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from src.autopilot_ops import (
    TaskSignal,
    build_plan_payload,
    build_roadmap,
    build_weekly_plan,
    filter_ranked_tasks,
    leverage_score,
    parse_task_payload,
    parse_tasks,
    main,
    rank_tasks,
    render_markdown,
    task_value,
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

    def _row(self, **overrides):
        row = {"project": "p", "task": "t", "impact": 5, "urgency": 5, "confidence": 0.8, "effort": 2}
        row.update(overrides)
        return row

    def test_parse_rejects_nan_infinity_and_negative_values(self):
        for field, value in (("impact", "nan"), ("urgency", "inf"), ("effort", -1), ("impact", "lots")):
            with self.subTest(field=field, value=value):
                with self.assertRaises(ValueError) as caught:
                    parse_task_payload([self._row(**{field: value})])
                self.assertIn(field, str(caught.exception))

    def test_confidence_accepts_a_percent(self):
        fraction, percent = parse_task_payload([self._row(confidence=0.8), self._row(confidence=80)])
        self.assertAlmostEqual(fraction.confidence, 0.8)
        self.assertAlmostEqual(percent.confidence, 0.8)
        self.assertEqual(leverage_score(fraction), leverage_score(percent))
        with self.assertRaises(ValueError):
            parse_task_payload([self._row(confidence=150)])

    def test_used_effort_counts_the_floor_the_packer_used(self):
        tasks = parse_task_payload([self._row(task=f"t{i}", effort=0) for i in range(4)])
        payload = build_plan_payload(tasks, effort_budget=1.0)
        self.assertEqual(len(payload["weeklyPlan"]), 4)
        self.assertEqual(payload["usedEffort"], 1.0)

    def test_optimal_packing_beats_greedy_on_the_dantzig_counterexample(self):
        # Balanced weights: 1.8 * impact + 1.2 * urgency, so x and x gives 3x.
        big = TaskSignal("a", "one big task", 7 / 3, 7 / 3, 1.0, 6.0)
        half_1 = TaskSignal("b", "first half", 5.5 / 3, 5.5 / 3, 1.0, 5.0)
        half_2 = TaskSignal("c", "second half", 5.5 / 3, 5.5 / 3, 1.0, 5.0)
        tasks = [big, half_1, half_2]

        greedy = build_weekly_plan(tasks, 10.0, packing="greedy")
        optimal = build_weekly_plan(tasks, 10.0)
        self.assertEqual([t.project for t in greedy], ["a"])
        self.assertEqual([t.project for t in optimal], ["b", "c"])

        payload = build_plan_payload(tasks, effort_budget=10.0)
        self.assertEqual(payload["packing"], "optimal")
        self.assertAlmostEqual(payload["planValue"], 11.0)
        self.assertEqual(payload["usedEffort"], 10.0)

    def test_optimal_packing_matches_brute_force(self):
        import itertools
        import random

        rng = random.Random(7)
        for _ in range(60):
            tasks = [
                TaskSignal("p", f"t{i}", rng.uniform(1, 10), rng.uniform(1, 10),
                           rng.uniform(0.3, 1), round(rng.uniform(0.25, 8), 2))
                for i in range(rng.randint(1, 8))
            ]
            budget = round(rng.uniform(0, 20), 2)
            best = 0.0
            for r in range(len(tasks) + 1):
                for combo in itertools.combinations(tasks, r):
                    if sum(t.effort for t in combo) <= budget + 1e-9:
                        best = max(best, sum(task_value(t) for t in combo))
            plan = build_weekly_plan(tasks, budget)
            self.assertLessEqual(sum(t.effort for t in plan), budget + 1e-9)
            self.assertAlmostEqual(sum(task_value(t) for t in plan), best, places=6)

    def test_huge_budgets_fall_back_to_greedy_and_say_so(self):
        payload = build_plan_payload(self.tasks, effort_budget=10_000_000.0)
        self.assertEqual(payload["packing"], "greedy")
        self.assertEqual(len(payload["weeklyPlan"]), 3)


if __name__ == "__main__":
    unittest.main()


class CliErrorTests(unittest.TestCase):
    def run_cli(self, *argv):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit) as raised:
            main(list(argv))
        return raised.exception.code, stderr.getvalue()

    def test_missing_file_is_a_one_line_error(self):
        code, message = self.run_cli("--input", "does-not-exist.json")
        self.assertEqual(code, 2)
        self.assertIn("input file not found", message)
        self.assertNotIn("Traceback", message)

    def test_broken_json_names_the_position(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "tasks.json"
            path.write_text('[{"project": "a",', encoding="utf-8")
            code, message = self.run_cli("--input", str(path))
        self.assertEqual(code, 2)
        self.assertIn("not valid JSON (line 1", message)

    def test_nan_budget_is_rejected(self):
        sample = Path(__file__).resolve().parent.parent / "data" / "tasks.sample.json"
        code, message = self.run_cli("--input", str(sample), "--budget", "nan")
        self.assertEqual(code, 2)
        self.assertIn("Budget must be a finite number", message)

    def test_negative_budget_is_rejected_by_the_payload_builder(self):
        tasks = [TaskSignal("p", "t", 1, 1, 1, 1)]
        with self.assertRaises(ValueError):
            build_plan_payload(tasks, effort_budget=-1)


class CsvInputTests(unittest.TestCase):
    def test_csv_header_order_and_case_do_not_matter(self):
        text = "Effort,Task,PROJECT,impact,urgency,confidence\n3,ship it,core,8,7,80\n\n"
        with TemporaryDirectory() as folder:
            path = Path(folder) / "tasks.csv"
            path.write_text(text, encoding="utf-8")
            tasks = parse_tasks(path)
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0].project, "core")
        self.assertAlmostEqual(tasks[0].confidence, 0.8)
        self.assertEqual(tasks[0].effort, 3.0)

    def test_csv_missing_column_is_named(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "tasks.csv"
            path.write_text("project,task,impact\na,b,1\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "urgency, confidence, effort"):
                parse_tasks(path)

    def test_csv_bad_number_reports_row(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "tasks.csv"
            path.write_text("project,task,impact,urgency,confidence,effort\na,b,high,1,1,1\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "index 0: 'impact' must be a number"):
                parse_tasks(path)

    def test_excel_bom_is_ignored(self):
        with TemporaryDirectory() as folder:
            path = Path(folder) / "tasks.csv"
            path.write_bytes("\ufeffproject,task,impact,urgency,confidence,effort\na,b,1,1,1,1\n".encode("utf-8"))
            self.assertEqual(parse_tasks(path)[0].project, "a")


class RoadmapTests(unittest.TestCase):
    def setUp(self):
        self.tasks = [TaskSignal("p", f"t{i}", 5 + i, 5, 1.0, 4.0) for i in range(5)]

    def test_week_one_matches_the_weekly_plan(self):
        payload = build_plan_payload(self.tasks, effort_budget=8, weeks=3)
        week_one = [row["task"] for row in payload["roadmap"][0]["tasks"]]
        self.assertEqual(week_one, [row["task"] for row in payload["weeklyPlan"]])

    def test_every_task_lands_in_exactly_one_week(self):
        schedule = build_roadmap(self.tasks, 8, weeks=4)
        names = [task.task for week in schedule for task in week]
        self.assertEqual(sorted(names), sorted(task.task for task in self.tasks))
        self.assertEqual(len(schedule), 3)

    def test_unscheduled_counts_what_did_not_fit_in_time(self):
        payload = build_plan_payload(self.tasks, effort_budget=8, weeks=2)
        self.assertEqual(len(payload["roadmap"]), 2)
        self.assertEqual(payload["unscheduled"], 1)

    def test_tasks_bigger_than_a_week_stop_the_roadmap(self):
        tasks = [TaskSignal("p", "huge", 9, 9, 1.0, 50.0)]
        payload = build_plan_payload(tasks, effort_budget=8, weeks=3)
        self.assertEqual(payload["roadmap"], [])
        self.assertEqual(payload["unscheduled"], 1)

    def test_duplicate_rows_are_both_scheduled(self):
        tasks = [TaskSignal("p", "same", 5, 5, 1.0, 4.0), TaskSignal("p", "same", 5, 5, 1.0, 4.0)]
        schedule = build_roadmap(tasks, 4, weeks=2)
        self.assertEqual([len(week) for week in schedule], [1, 1])

    def test_weeks_out_of_range_is_rejected(self):
        with self.assertRaises(ValueError):
            build_plan_payload(self.tasks, effort_budget=8, weeks=0)

    def test_single_week_payload_has_no_roadmap(self):
        self.assertNotIn("roadmap", build_plan_payload(self.tasks, effort_budget=8))


class MarkdownTests(unittest.TestCase):
    def test_markdown_lists_plan_and_later_weeks(self):
        tasks = [TaskSignal("core", f"step {i}", 5 + i, 5, 1.0, 4.0) for i in range(3)]
        text = render_markdown(build_plan_payload(tasks, effort_budget=8, weeks=2))
        self.assertIn("## Weekly plan", text)
        self.assertIn("| core | step 2 |", text)
        self.assertIn("### Week 2", text)

    def test_pipes_in_task_names_do_not_break_the_table(self):
        tasks = [TaskSignal("core", "a | b", 5, 5, 1.0, 1.0)]
        text = render_markdown(build_plan_payload(tasks, effort_budget=8))
        self.assertIn("a \\| b", text)

    def test_empty_plan_says_so(self):
        tasks = [TaskSignal("core", "huge", 5, 5, 1.0, 40.0)]
        self.assertIn("Nothing fits", render_markdown(build_plan_payload(tasks, effort_budget=8)))
