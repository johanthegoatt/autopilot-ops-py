/**
 * The planner, in the browser.
 *
 * This is a direct port of `leverage_score`, `rank_tasks`,
 * `filter_ranked_tasks` and `build_weekly_plan` from src/autopilot_ops.py. It
 * exists so the tool works when there is no Python behind it: on a static host
 * the /api/plan endpoint is not there, and without this the only button that
 * matters returns a 404.
 *
 * The server stays authoritative. This runs only when the request fails, and
 * the response it builds has the same shape the API returns, so renderPlan
 * cannot tell the difference.
 *
 * Every constant here is copied from the Python rather than re-derived. If the
 * weights change there they have to change here, and tests/planner.browser
 * .test.js checks the two agree on the sample set.
 */

/* A classic script, not a module: app.js is loaded as one, and adding a
   module boundary for a single 120-line file would mean converting that too. */
(function (global) {
  "use strict";

  const VALID_STRATEGIES = ["balanced", "impact", "urgency"];
  
  /** Python: _clamp_confidence */
  function clampConfidence(value) {
    return Math.min(Math.max(Number(value) || 0, 0), 1);
  }
  
  /**
   * Python: _normalized_effort.
   *
   * The floor is what stops a task declared as zero effort dividing by nothing
   * and ranking above everything else forever.
   */
  function normalizedEffort(value) {
    return Math.max(Number(value) || 0, 0.25);
  }
  
  /** Python: leverage_score */
  function leverageScore(task, strategy = "balanced") {
    const effort = normalizedEffort(task.effort);
    const confidence = clampConfidence(task.confidence);
    const impact = Number(task.impact) || 0;
    const urgency = Number(task.urgency) || 0;
  
    let weighted;
    if (strategy === "impact") weighted = impact * 2.2 + urgency * 0.8;
    else if (strategy === "urgency") weighted = impact * 1.2 + urgency * 2.0;
    else weighted = impact * 1.8 + urgency * 1.2;
  
    return (weighted * confidence) / effort;
  }
  
  /**
   * Python: rank_tasks.
   *
   * The tie-breakers matter and are not decoration. Two tasks with the same
   * score must come out in the same order on every run and on both
   * implementations, or the plan changes when nothing about the input did.
   */
  function rankTasks(tasks, strategy = "balanced") {
    return [...tasks].sort((a, b) => {
      const d = leverageScore(b, strategy) - leverageScore(a, strategy);
      if (d) return d;
      if (b.impact !== a.impact) return b.impact - a.impact;
      if (b.urgency !== a.urgency) return b.urgency - a.urgency;
      const p = String(a.project).toLowerCase().localeCompare(String(b.project).toLowerCase());
      if (p) return p;
      return String(a.task).toLowerCase().localeCompare(String(b.task).toLowerCase());
    });
  }
  
  /** Python: filter_ranked_tasks */
  function filterRanked(tasks, { minScore = 0, top = 0, strategy = "balanced" } = {}) {
    const kept = tasks.filter(t => leverageScore(t, strategy) >= minScore);
    return top > 0 ? kept.slice(0, top) : kept;
  }
  
  /** Python: task_value. The score before it is divided by effort. */
  function taskValue(task, strategy = "balanced") {
    return leverageScore(task, strategy) * normalizedEffort(task.effort);
  }

  /* Python: EFFORT_STEP and MAX_DP_CELLS. Kept equal so both sides switch to
     greedy at the same size and pick the same plan below it. */
  const EFFORT_STEP = 0.01;
  const MAX_DP_CELLS = 1000000;
  const VALID_PACKINGS = ["optimal", "greedy"];

  const units = effort => Math.ceil(effort / EFFORT_STEP - 1e-9);
  const capacityOf = budget => Math.floor(Math.max(Number(budget) || 0, 0) / EFFORT_STEP + 1e-9);

  /** Python: plan_packing */
  function planPacking(taskCount, budget, packing = "optimal") {
    if (packing === "greedy") return "greedy";
    return taskCount * (capacityOf(budget) + 1) <= MAX_DP_CELLS ? "optimal" : "greedy";
  }

  /** Python: _greedy_plan. Score order, skipping whatever does not fit. */
  function greedyPlan(ranked, budget) {
    const selected = [];
    let used = 0;
    for (const task of ranked) {
      const effort = normalizedEffort(task.effort);
      if (used + effort > budget) continue;
      selected.push(task);
      used += effort;
    }
    return selected;
  }

  /**
   * Python: _optimal_plan. 0/1 knapsack over hundredths of effort; best[c] is
   * the most value that fits in c units, keep[i] which capacities took task i.
   * Same loop order and the same strict comparison as the Python, so ties
   * resolve to the same plan in both.
   */
  function optimalPlan(ranked, budget, strategy) {
    const capacity = capacityOf(budget);
    const best = new Float64Array(capacity + 1);
    const keep = [];
    for (const task of ranked) {
      const weight = units(normalizedEffort(task.effort));
      const value = taskValue(task, strategy);
      const took = new Uint8Array(capacity + 1);
      for (let c = capacity; c >= weight; c--) {
        const candidate = best[c - weight] + value;
        if (candidate > best[c] + 1e-9) {
          best[c] = candidate;
          took[c] = 1;
        }
      }
      keep.push(took);
    }
    const chosen = [];
    let c = capacity;
    for (let i = ranked.length - 1; i >= 0; i--) {
      if (keep[i][c]) {
        chosen.push(ranked[i]);
        c -= units(normalizedEffort(ranked[i].effort));
      }
    }
    return chosen.reverse();
  }

  /**
   * Python: build_weekly_plan. Returns the tasks in rank order plus the
   * effort they use, counted with the same floor the packer used.
   */
  function buildWeeklyPlan(tasks, budget, strategy = "balanced", packing = "optimal") {
    const ranked = rankTasks(tasks, strategy);
    const safeBudget = Math.max(Number(budget) || 0, 0);
    const selected = planPacking(ranked.length, safeBudget, packing) === "greedy"
      ? greedyPlan(ranked, safeBudget)
      : optimalPlan(ranked, safeBudget, strategy);
    const used = selected.reduce((n, t) => n + normalizedEffort(t.effort), 0);
    return { selected, used };
  }

  /** Python: build_roadmap. Week after week from what is left. */
  function buildRoadmap(tasks, budget, weeks, strategy = "balanced", packing = "optimal") {
    let remaining = rankTasks(tasks, strategy);
    const schedule = [];
    for (let week = 0; week < weeks && remaining.length; week++) {
      const { selected } = buildWeeklyPlan(remaining, budget, strategy, packing);
      if (!selected.length) break;
      schedule.push(selected);
      const taken = new Set(selected);
      remaining = remaining.filter((task) => !taken.has(task));
    }
    return schedule;
  }

  /**
   * Builds the same payload shape /api/plan returns, so the renderer does not
   * need to know which one produced it.
   */
  function planLocally({ tasks, budget, top, minScore, strategy, packing, weeks = 1 }) {
    const useStrategy = VALID_STRATEGIES.includes(strategy) ? strategy : "balanced";
    const usePacking = VALID_PACKINGS.includes(packing) ? packing : "optimal";
  
    const withScores = t => ({ ...t, score: leverageScore(t, useStrategy) });
  
    const ranked = filterRanked(rankTasks(tasks, useStrategy), {
      minScore: Number(minScore) || 0,
      top: Number(top) || 0,
      strategy: useStrategy
    }).map(withScores);
  
    const packingUsed = planPacking(ranked.length, budget, usePacking);
    const { selected, used } = buildWeeklyPlan(ranked, budget, useStrategy, packingUsed);
  
    const payload = {
      budget: Number(budget) || 0,
      usedEffort: Number(used.toFixed(2)),
      planValue: Number(selected.reduce((n, t) => n + taskValue(t, useStrategy), 0).toFixed(4)),
      filters: { strategy: useStrategy, top: Number(top) || 0, minScore: Number(minScore) || 0 },
      packing: packingUsed,
      ranked,
      weeklyPlan: selected.map(withScores),
      computedIn: "browser"
    };

    const weekCount = Math.min(Math.max(Math.trunc(Number(weeks) || 1), 1), 52);
    if (weekCount > 1) {
      const schedule = buildRoadmap(ranked, budget, weekCount, useStrategy, packingUsed);
      payload.roadmap = schedule.map((week, index) => ({
        week: index + 1,
        tasks: week.map(withScores),
        usedEffort: Number(week.reduce((n, t) => n + normalizedEffort(t.effort), 0).toFixed(2)),
        value: Number(week.reduce((n, t) => n + taskValue(t, useStrategy), 0).toFixed(4))
      }));
      payload.unscheduled = ranked.length - schedule.reduce((n, week) => n + week.length, 0);
    }
    return payload;
  }

  // Python's :g drops trailing zeros; toString does the same for these ranges.
  const g = (value) => String(Number(value));

  function markdownTable(rows) {
    const lines = ["| Project | Task | Score | Effort |", "| --- | --- | ---: | ---: |"];
    for (const row of rows) {
      const project = String(row.project).replace(/\|/g, "\\|");
      const task = String(row.task).replace(/\|/g, "\\|");
      lines.push(`| ${project} | ${task} | ${Number(row.score).toFixed(2)} | ${g(row.effort)} |`);
    }
    return lines;
  }

  /** Python: render_markdown. */
  function renderMarkdown(payload) {
    let lines = [
      "## Weekly plan",
      "",
      `Budget ${g(payload.budget)}, used ${g(payload.usedEffort)}, `
        + `value ${Number(payload.planValue).toFixed(1)} (${payload.filters.strategy}, ${payload.packing} packing)`,
      ""
    ];
    lines = payload.weeklyPlan.length
      ? lines.concat(markdownTable(payload.weeklyPlan))
      : lines.concat("Nothing fits this budget.");
    for (const week of (payload.roadmap || []).slice(1)) {
      lines = lines.concat("", `### Week ${week.week}`, "", markdownTable(week.tasks));
    }
    if (payload.unscheduled) {
      lines.push("", `${payload.unscheduled} ranked task(s) do not fit in the roadmap.`);
    }
    return lines.join("\n") + "\n";
  }

  global.AutopilotPlanner = {
    renderMarkdown,
    leverageScore, taskValue, rankTasks, filterRanked, planPacking, buildWeeklyPlan, buildRoadmap, planLocally
  };
})(window);
