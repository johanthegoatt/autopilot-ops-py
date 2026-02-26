import unittest

from fastapi.testclient import TestClient

from api.health import app


class AutopilotOpsHealthApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_endpoint_returns_ok(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "service": "autopilot-ops-py"})


if __name__ == "__main__":
    unittest.main()
