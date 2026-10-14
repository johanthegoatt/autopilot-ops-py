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
const { leverageScore, planLocally } = globalThis.AutopilotPlanner;

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
