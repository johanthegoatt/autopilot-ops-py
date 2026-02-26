# Autopilot Ops (Python)

Autopilot Ops ranks engineering work by leverage and builds weekly plans that respect an effort budget.  
The project now ships as both:

- a CLI planner (`src/autopilot_ops.py`)
- a live browser app + API (`index.html` + `POST /api/plan`)

## Features

- Score tasks by impact, urgency, confidence, and effort
- Rank tasks with strategy selection (`balanced`, `impact`, `urgency`)
- Build budget-constrained weekly plans
- Run as CLI, API, or interactive web UI

## Setup

```powershell
cd autopilot-ops-py
python -m pip install -e .
python -m pip install -r requirements.txt
```

## CLI Usage

Generate a plan:

```powershell
cd autopilot-ops-py
python src/autopilot_ops.py --input data/tasks.sample.json --budget 18 --output data/plan.out.json
```

Filter to top candidates:

```powershell
cd autopilot-ops-py
python src/autopilot_ops.py --input data/tasks.sample.json --budget 18 --top 5 --min-score 3.5
```

Switch scoring strategy:

```powershell
cd autopilot-ops-py
python src/autopilot_ops.py --input data/tasks.sample.json --budget 18 --strategy urgency
```

Module entry point:

```powershell
cd autopilot-ops-py
python -m src --input data/tasks.sample.json --budget 18
```

## API Usage

### Local API server (uvicorn)

```powershell
cd autopilot-ops-py
python -m uvicorn api.plan:app --reload --port 8000
```

`POST /` on this local server returns the same payload shape as the CLI.

### Vercel endpoint shape

- Production endpoint: `POST /api/plan`
- Health endpoint: `GET /api/health`

Example request:

```powershell
curl -X POST "http://127.0.0.1:3000/api/plan" ^
  -H "Content-Type: application/json" ^
  -d "{\"tasks\":[{\"project\":\"portfolio\",\"task\":\"Refine hero copy\",\"impact\":8.2,\"urgency\":7.1,\"confidence\":0.9,\"effort\":3.0}],\"budget\":18,\"top\":0,\"minScore\":0,\"strategy\":\"balanced\"}"
```

## Live UI (Local)

To run UI + API together with Vercel routing:

```powershell
cd autopilot-ops-py
npx --yes vercel dev
```

Then open the local URL emitted by Vercel (usually `http://127.0.0.1:3000`).

## Tests

```powershell
cd autopilot-ops-py
python -m unittest discover -s tests -p "test_*.py"
```
