# Autopilot Ops (Python)

Autopilot Ops ranks engineering work by leverage and builds weekly plans that respect an effort budget.  
The project now ships as both:

- a CLI planner (`src/autopilot_ops.py`)
- a live browser app + API (`index.html` + `POST /api/plan`)

## Features

- Score tasks by impact, urgency, confidence, and effort
- Rank tasks with strategy selection (`balanced`, `impact`, `urgency`)
- Build weekly plans that fit the most value into an effort budget
- Say why each task was left out: under the minimum score, outside the top N, or too big for what is left
- Run as CLI, API, or interactive web UI, and plan in the browser when the API is not there

## How the weekly plan is packed

Each task is worth `weighted impact and urgency x confidence`, and its score is that value divided by effort.
Taking tasks in score order until the budget runs out is Dantzig's greedy rule for the knapsack problem, and it
can leave value on the table. With 10 hours, a 6 hour task worth 7 has the best score, but two 5 hour tasks worth
5.5 each are worth 11 together. On the sample set with a 5 hour budget, score order picks one 2.8 hour task worth
20.5; the packer picks the 4.5 hour task worth 23.3.

The default `optimal` packing solves the 0/1 knapsack exactly with dynamic programming over hundredths of effort
(efforts round up, so a plan never runs over). It is checked against brute force on random task sets in both the
Python and the browser port. Above a million table cells it falls back to score order and reports
`"packing": "greedy"` in the payload. `--packing greedy` asks for score order directly.

Inputs are checked before scoring: NaN, infinite and negative numbers are rejected with the row and field named,
and confidence can be written as a fraction (`0.8`) or a percent (`80`), the way RICE writes it.

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

Plan straight from a spreadsheet export (header names the six fields, any order) or from stdin:

```powershell
cd autopilot-ops-py
python src/autopilot_ops.py --input backlog.csv --budget 18
type backlog.csv | python src/autopilot_ops.py --input - --budget 18
```

Filter to top candidates:

```powershell
cd autopilot-ops-py
python src/autopilot_ops.py --input data/tasks.sample.json --budget 18 --top 5 --min-score 3.5
```

Compare with score-order packing:

```powershell
cd autopilot-ops-py
python src/autopilot_ops.py --input data/tasks.sample.json --budget 5 --packing greedy
```

Lay out the next few weeks, each packed from what the earlier weeks left:

```powershell
cd autopilot-ops-py
python src/autopilot_ops.py --input data/tasks.sample.json --budget 8 --weeks 4
```

Print Markdown instead of JSON, ready to paste into a standup note:

```powershell
cd autopilot-ops-py
python src/autopilot_ops.py --input data/tasks.sample.json --budget 8 --weeks 2 --format markdown
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
node --test tests/planner.browser.test.mjs
```
