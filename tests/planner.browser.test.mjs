/**
 * The browser planner must agree with the Python one.
 *
 * Two implementations of the same scoring is a liability: the moment they
 * disagree, the tool gives one answer with a service behind it and a different
 * answer without, and nobody notices because both look plausible. This pins
 * them together on the sample set.
 *
 * The expected values are not hand-written. They were produced by running
 * src/autopilot_ops.py over data/tasks.sample.json, so a change to the Python
 * weights fails this test rather than silently forking the two.
 *
 *   node --test tests/planner.browser.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// The planner is a classic script publishing one global, so it is loaded the
// same way the page loads it rather than imported.
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(path.join(ROOT, "src/planner.browser.js"), "utf8"));
const { leverageScore, taskValue, buildWeeklyPlan, planLocally } = globalThis.AutopilotPlanner;

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data/tasks.sample.json"), "utf8"));
const TASKS = Array.isArray(raw) ? raw : (raw.tasks || []);

/** Straight from src/autopilot_ops.py over data/tasks.sample.json. */
const FROM_PYTHON = {
  balanced: [
    ["workflow-cli-kit", 7.328571],
    ["globe-control", 6.03225],
    ["portfolio", 5.184],
    ["timecapsule-vault", 3.3384]
  ],
  impact: [
    ["workflow-cli-kit", 7.396429],
    ["globe-control", 6.14775],
    ["portfolio", 5.296],
    ["timecapsule-vault", 3.3696]
  ],
  urgency: [
    ["workflow-cli-kit", 7.695],
    ["globe-control", 6.2265],
    ["portfolio", 5.328],
    ["timecapsule-vault", 3.5048]
  ]
};

for (const [strategy, expected] of Object.entries(FROM_PYTHON)) {
  test(`${strategy}: order and scores match the Python`, () => {
    const plan = planLocally({ tasks: TASKS, budget: 18, top: 0, minScore: 0, strategy });

    assert.equal(plan.ranked.length, expected.length);
    plan.ranked.forEach((task, i) => {
      assert.equal(task.project, expected[i][0], `position ${i}`);
      // Six decimal places is well inside the difference that would change an
      // ordering, and outside float noise between the two runtimes.
      assert.ok(
        Math.abs(leverageScore(task, strategy) - expected[i][1]) < 1e-6,
        `${task.project} scored ${leverageScore(task, strategy)}, Python said ${expected[i][1]}`
      );
    });
  });
}

test("the weekly plan respects the effort budget", () => {
  const plan = planLocally({ tasks: TASKS, budget: 10, top: 0, minScore: 0, strategy: "balanced" });
  const used = plan.weeklyPlan.reduce((n, t) => n + Math.max(t.effort, 0.25), 0);
  assert.ok(used <= 10, `used ${used} against a budget of 10`);
});

test("a cheap task still fits after an expensive one is skipped", () => {
  // Packing, not truncating: a budget that cannot fit the top-ranked task must
  // still admit a smaller one further down.
  const tasks = [
    { project: "big", task: "expensive", impact: 10, urgency: 10, confidence: 1, effort: 40 },
    { project: "small", task: "cheap", impact: 1, urgency: 1, confidence: 1, effort: 1 }
  ];
  const plan = planLocally({ tasks, budget: 2, top: 0, minScore: 0, strategy: "balanced" });
  assert.deepEqual(plan.weeklyPlan.map(t => t.project), ["small"]);
});

test("zero effort cannot divide by nothing", () => {
  const score = leverageScore({ impact: 5, urgency: 5, confidence: 1, effort: 0 }, "balanced");
  assert.ok(Number.isFinite(score), "score must be finite when effort is zero");
});

test("packs the most value, not the best scores first (Dantzig counterexample)", () => {
  // Same three tasks as the Python test: greedy takes the 6 hour task worth 7,
  // the optimal plan takes the two 5 hour tasks worth 11 together.
  const tasks = [
    { project: "a", task: "one big task", impact: 7 / 3, urgency: 7 / 3, confidence: 1, effort: 6 },
    { project: "b", task: "first half", impact: 5.5 / 3, urgency: 5.5 / 3, confidence: 1, effort: 5 },
    { project: "c", task: "second half", impact: 5.5 / 3, urgency: 5.5 / 3, confidence: 1, effort: 5 }
  ];
  const greedy = planLocally({ tasks, budget: 10, strategy: "balanced", packing: "greedy" });
  const optimal = planLocally({ tasks, budget: 10, strategy: "balanced" });
  assert.deepEqual(greedy.weeklyPlan.map(t => t.project), ["a"]);
  assert.deepEqual(optimal.weeklyPlan.map(t => t.project), ["b", "c"]);
  assert.equal(optimal.packing, "optimal");
  assert.equal(optimal.planValue, 11);
  assert.equal(optimal.usedEffort, 10);
});

test("the optimal plan matches brute force on random task sets", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let round = 0; round < 60; round++) {
    const tasks = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, i) => ({
      project: "p", task: `t${i}`,
      impact: 1 + rand() * 9, urgency: 1 + rand() * 9, confidence: 0.3 + rand() * 0.7,
      effort: Math.round((0.25 + rand() * 7.75) * 100) / 100
    }));
    const budget = Math.round(rand() * 2000) / 100;
    let best = 0;
    for (let mask = 0; mask < 1 << tasks.length; mask++) {
      const pick = tasks.filter((_, i) => mask & (1 << i));
      if (pick.reduce((n, t) => n + t.effort, 0) <= budget + 1e-9) {
        best = Math.max(best, pick.reduce((n, t) => n + taskValue(t), 0));
      }
    }
    const { selected, used } = buildWeeklyPlan(tasks, budget);
    assert.ok(used <= budget + 1e-9, `used ${used} of ${budget}`);
    assert.ok(Math.abs(selected.reduce((n, t) => n + taskValue(t), 0) - best) < 1e-6, `round ${round}`);
  }
});
