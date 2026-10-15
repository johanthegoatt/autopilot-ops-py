"use strict";

const REQUIRED_TASK_FIELDS = ["project", "task", "impact", "urgency", "confidence", "effort"];

const elements = {
  budget: document.getElementById("budget-input"),
  top: document.getElementById("top-input"),
  minScore: document.getElementById("min-score-input"),
  strategy: document.getElementById("strategy-input"),
  packing: document.getElementById("packing-input"),
  weeks: document.getElementById("weeks-input"),
  roadmapSection: document.getElementById("roadmap-section"),
  roadmapSummary: document.getElementById("roadmap-summary"),
  roadmapList: document.getElementById("roadmap-list"),
  loadSample: document.getElementById("load-sample-btn"),
  generate: document.getElementById("generate-btn"),
  addTask: document.getElementById("add-task-btn"),
  clearTasks: document.getElementById("clear-tasks-btn"),
  formToJson: document.getElementById("form-to-json-btn"),
  jsonToForm: document.getElementById("json-to-form-btn"),
  tasksJson: document.getElementById("tasks-json"),
  status: document.getElementById("status-text"),
  taskBody: document.getElementById("task-table-body"),
  rankedBody: document.getElementById("ranked-table-body"),
  weeklyBody: document.getElementById("weekly-table-body"),
  leftOutBody: document.getElementById("left-out-table-body"),
  responseJson: document.getElementById("response-json").querySelector("code"),
  metricBudget: document.getElementById("metric-budget"),
  metricUsed: document.getElementById("metric-used"),
  metricStrategy: document.getElementById("metric-strategy"),
  metricRanked: document.getElementById("metric-ranked"),
  metricValue: document.getElementById("metric-value"),
  metricLeft: document.getElementById("metric-left")
};

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`.trim();
}

function emptyTask() {
  return {
    project: "",
    task: "",
    impact: "",
    urgency: "",
    confidence: "",
    effort: ""
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseNumber(value, fieldName, rowNumber) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Row ${rowNumber}: ${fieldName} must be a valid number.`);
  }
  if (parsed < 0) {
    throw new Error(`Row ${rowNumber}: ${fieldName} cannot be negative.`);
  }
  return parsed;
}

// Same rule as _confidence in src/autopilot_ops.py: RICE writes confidence as
// a percent, so 80 means 0.8. Anything over 100 is a typo, not a percent.
function parseConfidence(value, rowNumber) {
  const parsed = parseNumber(value, "confidence", rowNumber);
  if (parsed <= 1) return parsed;
  if (parsed <= 100) return parsed / 100;
  throw new Error(`Row ${rowNumber}: confidence must be a fraction (0.8) or a percent (80).`);
}

function normalizeTask(task, index) {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    throw new Error(`Task at index ${index} must be an object.`);
  }

  for (const field of REQUIRED_TASK_FIELDS) {
    if (!(field in task)) {
      throw new Error(`Task at index ${index} is missing '${field}'.`);
    }
  }

  const rowNumber = index + 1;
  const project = String(task.project).trim();
  const taskName = String(task.task).trim();
  if (!project) {
    throw new Error(`Row ${rowNumber}: project is required.`);
  }
  if (!taskName) {
    throw new Error(`Row ${rowNumber}: task is required.`);
  }

  return {
    project,
    task: taskName,
    impact: parseNumber(task.impact, "impact", rowNumber),
    urgency: parseNumber(task.urgency, "urgency", rowNumber),
    confidence: parseConfidence(task.confidence, rowNumber),
    effort: parseNumber(task.effort, "effort", rowNumber)
  };
}

function normalizeTaskList(raw) {
  if (!Array.isArray(raw)) {
    throw new Error("Tasks JSON must be an array.");
  }

  if (raw.length === 0) {
    throw new Error("At least one task is required.");
  }

  return raw.map((task, index) => normalizeTask(task, index));
}

function buildRow(task = emptyTask()) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input data-key="project" type="text" value="${escapeHtml(task.project)}" placeholder="portfolio" /></td>
    <td><input data-key="task" type="text" value="${escapeHtml(task.task)}" placeholder="Refine docs" /></td>
    <td><input data-key="impact" type="number" step="0.1" value="${escapeHtml(task.impact)}" /></td>
    <td><input data-key="urgency" type="number" step="0.1" value="${escapeHtml(task.urgency)}" /></td>
    <td><input data-key="confidence" type="number" step="0.01" min="0" max="100" value="${escapeHtml(task.confidence)}" /></td>
    <td><input data-key="effort" type="number" step="0.1" value="${escapeHtml(task.effort)}" /></td>
    <td><button class="row-action" type="button" data-remove-task="1">Remove</button></td>
  `;
  return tr;
}

function renderTaskRows(tasks) {
  elements.taskBody.innerHTML = "";
  if (!Array.isArray(tasks) || tasks.length === 0) {
    elements.taskBody.appendChild(buildRow(emptyTask()));
    return;
  }

  for (const task of tasks) {
    elements.taskBody.appendChild(buildRow(task));
  }
}

function readTasksFromForm() {
  const rows = Array.from(elements.taskBody.querySelectorAll("tr"));
  const collected = [];

  rows.forEach((row, rowIndex) => {
    const entry = {};
    for (const field of REQUIRED_TASK_FIELDS) {
      const input = row.querySelector(`input[data-key="${field}"]`);
      entry[field] = input ? input.value : "";
    }

    const isCompletelyEmpty = REQUIRED_TASK_FIELDS.every((field) => String(entry[field]).trim() === "");
    if (isCompletelyEmpty) return;

    collected.push(normalizeTask(entry, rowIndex));
  });

  if (collected.length === 0) {
    throw new Error("Add at least one task before generating a plan.");
  }

  return collected;
}

function syncFormToJson() {
  const tasks = readTasksFromForm();
  elements.tasksJson.value = JSON.stringify(tasks, null, 2);
}

function applyJsonToForm() {
  const rawText = elements.tasksJson.value.trim();
  if (!rawText) {
    throw new Error("Tasks JSON is empty.");
  }
  const parsed = JSON.parse(rawText);
  const normalized = normalizeTaskList(parsed);
  renderTaskRows(normalized);
}

function parsePlannerSettings() {
  const budget = Number(elements.budget.value);
  const top = Number(elements.top.value);
  const minScore = Number(elements.minScore.value);
  const strategy = String(elements.strategy.value || "").trim();
  const packing = elements.packing.value === "greedy" ? "greedy" : "optimal";
  const weeks = Number(elements.weeks.value || 1);

  if (!Number.isFinite(budget)) {
    throw new Error("Budget must be a valid number.");
  }
  if (!Number.isInteger(top) || top < 0) {
    throw new Error("Top N must be an integer >= 0.");
  }
  if (!Number.isFinite(minScore)) {
    throw new Error("Min Score must be a valid number.");
  }
  if (!["balanced", "impact", "urgency"].includes(strategy)) {
    throw new Error("Strategy must be balanced, impact, or urgency.");
  }

  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    throw new Error("Weeks must be a whole number from 1 to 52.");
  }

  return { budget, top, minScore, strategy, packing, weeks };
}

function renderRows(targetBody, rows, fields) {
  targetBody.innerHTML = "";
  if (!Array.isArray(rows) || rows.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="${fields.length}">No tasks in this section.</td>`;
    targetBody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = fields.map((field) => `<td>${escapeHtml(row[field] ?? "")}</td>`).join("");
    targetBody.appendChild(tr);
  }
}

const taskKey = (task) => `${task.project}\u0000${task.task}`;

// Says why each submitted task is missing from the weekly plan, using the
// same three cuts the planner makes: min score, top N, then the budget.
function leftOutRows(submitted, payload) {
  const count = (rows) => {
    const counts = new Map();
    for (const row of rows || []) counts.set(taskKey(row), (counts.get(taskKey(row)) || 0) + 1);
    return counts;
  };
  const ranked = count(payload.ranked);
  const planned = count(payload.weeklyPlan);
  const minScore = Number(payload.filters?.minScore) || 0;
  const left = Math.max((Number(payload.budget) || 0) - (Number(payload.usedEffort) || 0), 0);
  const rows = [];

  for (const task of submitted) {
    const key = taskKey(task);
    if (planned.get(key) > 0) {
      planned.set(key, planned.get(key) - 1);
      ranked.set(key, ranked.get(key) - 1);
      continue;
    }
    let why;
    if (ranked.get(key) > 0) {
      ranked.set(key, ranked.get(key) - 1);
      const needs = Math.max(Number(task.effort) || 0, 0.25);
      why = needs > left
        ? `Needs ${needs} effort, ${Number(left.toFixed(2))} left`
        : "A higher value mix used the budget";
    } else {
      const score = window.AutopilotPlanner
        ? window.AutopilotPlanner.leverageScore(task, payload.filters?.strategy)
        : NaN;
      why = score < minScore ? `Score ${score.toFixed(2)} is under your minimum` : "Outside your top N";
    }
    rows.push({ project: task.project, task: task.task, effort: task.effort, why });
  }
  return rows;
}

function renderPlan(payload, submitted = []) {
  elements.metricBudget.textContent = String(payload.budget ?? "-");
  elements.metricUsed.textContent = String(payload.usedEffort ?? "-");
  elements.metricStrategy.textContent = String(payload.filters?.strategy ?? "-");
  elements.metricRanked.textContent = String(payload.ranked?.length ?? 0);
  elements.metricValue.textContent = payload.planValue == null
    ? "-"
    : `${Number(payload.planValue).toFixed(2)} (${payload.packing === "greedy" ? "best score first" : "most value"})`;
  elements.metricLeft.textContent = String(
    Number(Math.max((Number(payload.budget) || 0) - (Number(payload.usedEffort) || 0), 0).toFixed(2))
  );

  const rankedRows = (payload.ranked || []).map((item) => ({
    ...item,
    score: Number(item.score).toFixed(4)
  }));
  const weeklyRows = (payload.weeklyPlan || []).map((item) => ({
    ...item,
    score: Number(item.score).toFixed(4)
  }));

  renderRows(elements.rankedBody, rankedRows, [
    "project",
    "task",
    "score",
    "impact",
    "urgency",
    "confidence",
    "effort"
  ]);
  renderRows(elements.weeklyBody, weeklyRows, ["project", "task", "score", "effort"]);
  renderRows(elements.leftOutBody, leftOutRows(submitted, payload), ["project", "task", "effort", "why"]);

  renderRoadmap(payload);
  elements.responseJson.textContent = JSON.stringify(payload, null, 2);
}

function renderRoadmap(payload) {
  const weeks = Array.isArray(payload.roadmap) ? payload.roadmap : null;
  elements.roadmapSection.hidden = !weeks;
  if (!weeks) return;

  elements.roadmapList.replaceChildren(
    ...weeks.map((week) => {
      const item = document.createElement("li");
      const heading = document.createElement("strong");
      heading.textContent = `Week ${week.week}`;
      const meta = document.createElement("span");
      meta.className = "roadmap-meta";
      meta.textContent = `${week.usedEffort} effort, value ${Number(week.value).toFixed(1)}`;
      const tasks = document.createElement("ul");
      for (const task of week.tasks) {
        const entry = document.createElement("li");
        entry.textContent = `${task.project}: ${task.task} (${task.effort})`;
        tasks.appendChild(entry);
      }
      item.append(heading, meta, tasks);
      return item;
    })
  );
  const unscheduled = Number(payload.unscheduled) || 0;
  elements.roadmapSummary.textContent = unscheduled
    ? `${unscheduled} ranked task(s) do not fit in ${weeks.length || "any"} week(s) at this budget.`
    : `Every ranked task is scheduled within ${weeks.length} week(s).`;
}

async function generatePlan() {
  try {
    const tasks = readTasksFromForm();
    const settings = parsePlannerSettings();
    const body = {
      tasks,
      budget: settings.budget,
      top: settings.top,
      minScore: settings.minScore,
      strategy: settings.strategy,
      packing: settings.packing,
      weeks: settings.weeks
    };

    elements.tasksJson.value = JSON.stringify(tasks, null, 2);
    setStatus("Generating plan...", "");

    // The Python service is authoritative when it is there. On a static host
    // it is not, so a failed request falls through to the identical planner
    // compiled into the page rather than showing the user a 404. Both produce
    // the same payload shape, so nothing downstream has to care which ran.
    let payload = null;
    let ranOnServer = false;
    let rejection = null;

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const parsed = await response.json().catch(() => ({}));
      if (response.ok) {
        payload = parsed;
        ranOnServer = true;
      } else if (response.status >= 400 && response.status < 500 && response.status !== 404) {
        // A 4xx that is not "no such endpoint" means the service rejected this
        // input. Computing it locally would hide a real validation error.
        rejection = parsed?.error || parsed?.detail || `Request failed with status ${response.status}.`;
      }
    } catch {
      // Offline, blocked, or no service. Fall through.
    }

    if (rejection) {
      throw new Error(typeof rejection === "string" ? rejection : JSON.stringify(rejection));
    }

    if (!payload) {
      if (!window.AutopilotPlanner) {
        throw new Error("No planner available: the API is unreachable and the local planner did not load.");
      }
      payload = window.AutopilotPlanner.planLocally(body);
    }

    renderPlan(payload, tasks);
    setStatus(
      `Plan generated ${ranOnServer ? "by the service" : "in your browser"}. `
      + `Ranked ${payload.ranked.length} task(s).`,
      "success"
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not generate plan.", "error");
  }
}

async function loadSampleTasks() {
  try {
    setStatus("Loading sample tasks...", "");
    const response = await fetch("./data/tasks.sample.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Sample load failed with status ${response.status}.`);
    }
    const parsed = await response.json();
    const tasks = normalizeTaskList(parsed);
    renderTaskRows(tasks);
    elements.tasksJson.value = JSON.stringify(tasks, null, 2);
    setStatus(`Loaded ${tasks.length} sample task(s).`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Failed to load sample tasks.", "error");
  }
}

function wireEvents() {
  elements.addTask.addEventListener("click", () => {
    elements.taskBody.appendChild(buildRow(emptyTask()));
  });

  elements.clearTasks.addEventListener("click", () => {
    renderTaskRows([]);
    setStatus("Cleared task rows.", "");
  });

  elements.taskBody.addEventListener("click", (event) => {
    const removeButton = event.target.closest("button[data-remove-task]");
    if (!removeButton) return;

    const row = removeButton.closest("tr");
    if (!row) return;
    row.remove();
    if (elements.taskBody.children.length === 0) {
      renderTaskRows([]);
    }
  });

  elements.formToJson.addEventListener("click", () => {
    try {
      syncFormToJson();
      setStatus("Form exported to JSON.", "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not export form to JSON.", "error");
    }
  });

  elements.jsonToForm.addEventListener("click", () => {
    try {
      applyJsonToForm();
      setStatus("JSON imported to form.", "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not import JSON.", "error");
    }
  });

  elements.loadSample.addEventListener("click", loadSampleTasks);
  elements.generate.addEventListener("click", generatePlan);
}

function init() {
  renderTaskRows([]);
  wireEvents();
  setStatus("Add tasks manually or load the sample set.", "");
}

init();
