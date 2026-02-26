# Changelog

## 0.3.0 - 2026-02-26

- Added reusable `build_plan_payload(...)` planner core shared by CLI and API.
- Added FastAPI endpoint for planning (`POST /api/plan`) with 400-level validation responses.
- Added health endpoint (`GET /api/health`) for deployment smoke checks.
- Added live frontend (`index.html`, `styles.css`, `app.js`) with task form + JSON input and plan output tables.
- Added API test coverage for valid payloads, invalid payloads, and filter parity with core planner behavior.
- Added Vercel and Python runtime config (`vercel.json`, `requirements.txt`) for real deployment.

## 0.2.0 - 2026-02-25

- Added ranking filters (`--top`, `--min-score`) for tighter planning control.
- Added stronger JSON input validation with explicit field-level errors.
- Added module entry point (`python -m src`) and project script metadata.
- Expanded test coverage for filtering, score clamping, and invalid input handling.
- Added `.gitignore` and runbook docs.

## 0.1.0 - 2026-02-23

- Initial leverage scoring and weekly budget planner.
