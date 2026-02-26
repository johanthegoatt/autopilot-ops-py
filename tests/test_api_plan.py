import unittest

from fastapi.testclient import TestClient

from api.plan import app
from src.autopilot_ops import build_plan_payload, parse_task_payload


class AutopilotOpsApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.tasks = [
            {
                "project": "workflow-cli-kit",
                "task": "Add runbook lint command",
                "impact": 7.4,
                "urgency": 6.9,
                "confidence": 0.95,
                "effort": 2.8,
            },
            {
                "project": "globe-control",
                "task": "Streamline camera start/stop reliability",
                "impact": 8.1,
                "urgency": 7.0,
                "confidence": 0.84,
                "effort": 3.2,
            },
            {
                "project": "portfolio",
                "task": "Refine project storytelling and visuals",
                "impact": 9.2,
                "urgency": 7.8,
                "confidence": 0.9,
                "effort": 4.5,
            },
        ]

    def test_generate_plan_returns_expected_shape(self):
        response = self.client.post(
            "/api/plan",
            json={
                "tasks": self.tasks,
                "budget": 18,
                "top": 0,
                "minScore": 0.0,
                "strategy": "balanced",
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("budget", payload)
        self.assertIn("filters", payload)
        self.assertIn("ranked", payload)
        self.assertIn("weeklyPlan", payload)
        self.assertIn("usedEffort", payload)

    def test_empty_tasks_are_rejected(self):
        response = self.client.post(
            "/api/plan",
            json={
                "tasks": [],
                "budget": 18,
                "top": 0,
                "minScore": 0.0,
                "strategy": "balanced",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_missing_required_task_fields_are_rejected(self):
        bad_tasks = [
            {
                "project": "portfolio",
                "task": "Refine copy",
                "impact": 8.0,
                "urgency": 7.0,
                "confidence": 0.9,
            }
        ]
        response = self.client.post(
            "/api/plan",
            json={
                "tasks": bad_tasks,
                "budget": 18,
                "top": 0,
                "minScore": 0.0,
                "strategy": "balanced",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_invalid_strategy_is_rejected(self):
        response = self.client.post(
            "/api/plan",
            json={
                "tasks": self.tasks,
                "budget": 18,
                "top": 0,
                "minScore": 0.0,
                "strategy": "random",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_top_and_min_score_match_core_planner_behavior(self):
        request_body = {
            "tasks": self.tasks,
            "budget": 18,
            "top": 2,
            "minScore": 5.5,
            "strategy": "balanced",
        }

        response = self.client.post("/api/plan", json=request_body)
        self.assertEqual(response.status_code, 200)
        payload = response.json()

        expected = build_plan_payload(
            parse_task_payload(request_body["tasks"]),
            effort_budget=request_body["budget"],
            top=request_body["top"],
            min_score=request_body["minScore"],
            strategy=request_body["strategy"],
        )

        self.assertEqual(payload["ranked"], expected["ranked"])
        self.assertEqual(payload["weeklyPlan"], expected["weeklyPlan"])
        for task in payload["ranked"]:
            self.assertGreaterEqual(task["score"], request_body["minScore"])
        self.assertLessEqual(len(payload["ranked"]), request_body["top"])


if __name__ == "__main__":
    unittest.main()
