#!/usr/bin/env node
// Creates the local records that admin screenshots need, using only the public REST API:
// demonstration teams, a documentation task type, a documentation project with one task of
// that type on the documentation dataset (assigned to the authenticated account) and an
// archived annotation. Re-running reuses existing records.
// Writes the instance-specific IDs to a fixtures file for `yarn docs:screenshots --fixtures`.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const { values } = parseArgs({
  options: {
    "base-url": { type: "string", default: "http://localhost:9000" },
    organization: { type: "string", default: "sample_organization" },
    output: { type: "string", default: ".docs-screenshots/fixtures.local.json" },
  },
});
const baseUrl = new URL(values["base-url"]).origin;
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseUrl).hostname))
  throw new Error("Fixture setup only runs against a local WEBKNOSSOS instance.");
const token = process.env.WK_AUTH_TOKEN;
if (!token) throw new Error("Export WK_AUTH_TOKEN for the local documentation account.");

// Project names may only contain letters and numbers.
const projectName = "DocumentationL4dense";
const archivedAnnotationName = "Documentation archived annotation";

async function api(route, method = "GET", body) {
  const response = await fetch(`${baseUrl}/api${route}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "X-Auth-Token": token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`${method} ${route}: HTTP ${response.status} ${await response.text()}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const defaults = JSON.parse(
  await fs.readFile(new URL("./fixtures.default.json", import.meta.url), "utf8"),
);
const { id: datasetId } = await api(
  `/datasets/disambiguate/${encodeURIComponent(values.organization)}/${encodeURIComponent(defaults.dataset)}/toId`,
);
const user = await api("/user");
const team = user.teams[0];
if (!team) throw new Error("The documentation account needs a team.");

const teams = await api("/teams");
for (const name of defaults.teams ?? []) {
  if (!teams.some((candidate) => candidate.name === name)) {
    await api("/teams", "POST", { name });
    console.log(`Created team ${name}`);
  }
}

let taskType = (await api("/taskTypes")).find(
  (candidate) => candidate.summary === defaults.taskType.summary,
);
if (!taskType) {
  taskType = await api("/taskTypes", "POST", {
    summary: defaults.taskType.summary,
    description: defaults.taskType.description,
    teamId: team.id,
    settings: {
      allowedModes: defaults.taskType.allowedModes,
      preferredMode: defaults.taskType.allowedModes[0],
      branchPointsAllowed: true,
      somaClickingAllowed: false,
      volumeInterpolationAllowed: false,
      mergerMode: false,
      magRestrictions: {},
    },
    recommendedConfiguration: null,
    tracingType: "skeleton",
  });
  console.log(`Created task type ${taskType.summary}`);
}

let project = (await api("/projects")).find((candidate) => candidate.name === projectName);
if (!project) {
  project = await api("/projects", "POST", {
    name: projectName,
    team: team.id,
    priority: 100,
    paused: false,
    expectedTime: 5400000,
    owner: user.id,
    isBlacklistedFromReport: true,
  });
  console.log(`Created project ${projectName}`);
}

// Tasks of the documentation project that use another task type predate the documentation
// task type; replace them so the task dashboard shows its description.
let task;
for (const candidate of await api("/tasks/list", "POST", { project: project.id })) {
  if (candidate.type.id === taskType.id) task ??= candidate;
  else {
    await api(`/tasks/${candidate.id}`, "DELETE");
    console.log(`Deleted task ${candidate.id} of another task type`);
  }
}
if (!task) {
  const [experience] = Object.entries(user.experiences ?? {});
  const created = await api("/tasks", "POST", [
    {
      taskTypeId: taskType.id,
      neededExperience: { domain: experience?.[0] ?? "sampleExp", value: 0 },
      pendingInstances: 1,
      projectName,
      datasetId,
      editPosition: defaults.viewer.position,
      editRotation: [0, 0, 0],
      description: "Trace the neuron through the documentation dataset.",
    },
  ]);
  task = created.tasks?.[0]?.success ?? created[0];
  if (!task?.id) throw new Error(`Task creation failed: ${JSON.stringify(created)}`);
  console.log(`Created task ${task.id}`);
}
const assigned = await api(`/tasks/${task.id}/annotations`);
if (!assigned.some((annotation) => annotation.owner?.id === user.id)) {
  await api(`/tasks/${task.id}/assign?userId=${user.id}`, "POST");
  console.log(`Assigned task ${task.id}`);
}

const archived = await api("/annotations/readable?isFinished=true&pageNumber=0");
if (!archived.some((annotation) => annotation.name === archivedAnnotationName)) {
  const annotation = await api(`/datasets/${datasetId}/createExplorational`, "POST", [
    { typ: "Skeleton", name: "Skeleton" },
  ]);
  await api(`/annotations/Explorational/${annotation.id}/edit`, "PATCH", {
    name: archivedAnnotationName,
  });
  await api(`/annotations/Explorational/${annotation.id}/finish?timestamp=${Date.now()}`, "PATCH");
  console.log(`Created archived annotation ${annotation.id}`);
}

const output = path.resolve(root, values.output);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify({ projectName, taskId: task.id }, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, output)}`);
