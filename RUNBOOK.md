# Autopilot Ops Python Runbook

## Purpose

Generate and inspect high-leverage weekly plans from task signals using CLI, API, or live web UI.

## Setup

```powershell
cd autopilot-ops-py
python -m pip install -e .
python -m pip install -r requirements.txt
```

## Run CLI

```powershell
cd autopilot-ops-py
python src/autopilot_ops.py --input data/tasks.sample.json --budget 18 --output data/plan.out.json
```

## Run CLI With Filters

```powershell
cd autopilot-ops-py
python src/autopilot_ops.py --input data/tasks.sample.json --budget 18 --top 5 --min-score 3.5
```

## Run API Locally

```powershell
cd autopilot-ops-py
python -m uvicorn api.plan:app --reload --port 8000
```

Smoke check:

```powershell
curl -X POST "http://127.0.0.1:8000/" ^
  -H "Content-Type: application/json" ^
  -d "{\"tasks\":[{\"project\":\"portfolio\",\"task\":\"Refine hero copy\",\"impact\":8.2,\"urgency\":7.1,\"confidence\":0.9,\"effort\":3.0}],\"budget\":18,\"top\":0,\"minScore\":0,\"strategy\":\"balanced\"}"
```

## Run Full Stack Locally (UI + API)

```powershell
cd autopilot-ops-py
npx --yes vercel dev
```

## Verify

```powershell
cd autopilot-ops-py
python -m unittest discover -s tests -p "test_*.py"
```
