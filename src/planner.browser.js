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
  
  /**
   * Python: build_weekly_plan.
   *
   * Greedy by score, skipping anything that does not fit rather than stopping at
   * the first thing that does not. A cheap high-scoring task after an expensive
   * one still gets in, which is the whole point of packing against a budget.
   */
  function buildWeeklyPlan(tasks, budget, strategy = "balanced") {
    const ranked = rankTasks(tasks, strategy);
    const safeBudget = Math.max(Number(budget) || 0, 0);
    const selected = [];
    let used = 0;
  
    for (const task of ranked) {
      const effort = normalizedEffort(task.effort);
      if (used + effort > safeBudget) continue;
      selected.push(task);
      used += effort;
    }
    return { selected, used };
  }
  
  /**
   * Builds the same payload shape /api/plan returns, so the renderer does not
   * need to know which one produced it.
   */
  function planLocally({ tasks, budget, top, minScore, strategy }) {
    const useStrategy = VALID_STRATEGIES.includes(strategy) ? strategy : "balanced";
  
    const withScores = t => ({ ...t, score: leverageScore(t, useStrategy) });
  
    const ranked = filterRanked(rankTasks(tasks, useStrategy), {
      minScore: Number(minScore) || 0,
      top: Number(top) || 0,
      strategy: useStrategy
    }).map(withScores);
  
    const { selected, used } = buildWeeklyPlan(ranked, budget, useStrategy);
  
    return {
      budget: Number(budget) || 0,
      usedEffort: Number(used.toFixed(4)),
      filters: { strategy: useStrategy, top: Number(top) || 0, minScore: Number(minScore) || 0 },
      ranked,
      weeklyPlan: selected.map(withScores),
      computedIn: "browser"
    };
  }

  global.AutopilotPlanner = { leverageScore, rankTasks, filterRanked, buildWeeklyPlan, planLocally };
})(window);
