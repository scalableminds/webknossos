#!/usr/bin/env node
// Creates the local records that admin screenshots need, using only the public REST API:
// demonstration teams, a documentation task type, a documentation project with one task of
// that type on the documentation dataset (assigned to the authenticated account), descriptions,
// tags and metadata of the example datasets, and named open and archived annotations with tags
// and descriptions. It also runs `yarn enable-jobs`. Re-running reuses existing records.
// Writes the instance-specific IDs to a fixtures file for `yarn docs:screenshots --fixtures`.
import { spawnSync } from "node:child_process";
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
// Earlier setups created a single archived annotation of this name; it is renamed and reused.
const legacyArchivedAnnotationName = "Documentation archived annotation";

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

// Job screenshots need jobs enabled: in application.conf and by a worker in the database.
// Re-running is harmless; the worker insert is an upsert.
const enableJobs = spawnSync("yarn", ["enable-jobs"], { cwd: root, stdio: "inherit" });
if (enableJobs.status !== 0) throw new Error("yarn enable-jobs failed.");
if (!(await api("/features")).jobsEnabled)
  console.log("Jobs are enabled in application.conf now; restart WEBKNOSSOS to apply it.");

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

// Descriptions, tags and metadata of the example datasets, shown in the dataset dashboard.
// The shared tag lets the dashboard recipe list exactly these datasets.
const exampleDatasets = defaults.exampleDatasets;
for (const [name, details] of Object.entries(exampleDatasets.datasets)) {
  let id;
  try {
    ({ id } = await api(
      `/datasets/disambiguate/${encodeURIComponent(values.organization)}/${encodeURIComponent(name)}/toId`,
    ));
  } catch {
    console.log(`Skipped missing example dataset ${name}`);
    continue;
  }
  const dataset = await api(`/datasets/${id}`);
  const metadata = [...(dataset.metadata ?? [])];
  for (const entry of details.metadata ?? []) {
    const index = metadata.findIndex(({ key }) => key === entry.key);
    if (index === -1) metadata.push(entry);
    else metadata[index] = entry;
  }
  await api(`/datasets/${id}/updatePartial`, "PATCH", {
    description: details.description,
    tags: [...new Set([...dataset.tags, ...details.tags, exampleDatasets.tag])],
    metadata,
  });
  console.log(`Updated example dataset ${name}`);
}

// Annotation descriptions live in the tracingstore and are changed with an update action.
const { token: userToken } = await api("/userToken/generate", "POST");
async function setAnnotationDescription(annotation, description) {
  const tracingStore = `${annotation.tracingStore.url}/tracings/annotation/${annotation.id}`;
  async function tracingStoreApi(route, body) {
    const response = await fetch(`${tracingStore}/${route}?token=${userToken}`, {
      method: body === undefined ? "GET" : "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`Tracingstore ${route}: HTTP ${response.status} ${await response.text()}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  const { version } = await tracingStoreApi("newestVersion");
  await tracingStoreApi("update", [
    {
      version: version + 1,
      timestamp: Date.now(),
      authorId: user.id,
      actions: [{ name: "updateMetadataOfAnnotation", value: { description } }],
      transactionId: `docs-screenshots-${Date.now()}`,
      transactionGroupCount: 1,
      transactionGroupIndex: 0,
      stats: null,
      info: "[]",
    },
  ]);
}

// Open and archived demonstration annotations on the documentation dataset. Archived ones are
// reopened while their name, tags or description change, since archived annotations are read-only.
const existingAnnotations = [
  ...(await api("/annotations/readable?isFinished=false&pageNumber=0")),
  ...(await api("/annotations/readable?isFinished=true&pageNumber=0")),
].filter((annotation) => (annotation.datasetId ?? annotation.dataSetId) === datasetId);
let legacyArchived = existingAnnotations.find(
  (annotation) =>
    annotation.name === legacyArchivedAnnotationName && annotation.state === "Finished",
);
for (const [archived, fixtures] of [
  [false, defaults.annotations.open],
  [true, defaults.annotations.archived],
]) {
  for (const { name, description, tags } of fixtures) {
    let existing = existingAnnotations.find((annotation) => annotation.name === name);
    if (!existing && archived && legacyArchived) {
      existing = legacyArchived;
      legacyArchived = undefined;
    }
    let id = existing?.id;
    if (!id) {
      ({ id } = await api(`/datasets/${datasetId}/createExplorational`, "POST", [
        { typ: "Skeleton", name: "Skeleton" },
      ]));
      console.log(`Created annotation ${name}`);
    }
    const isFinished = existing?.state === "Finished";
    // The dataset name is listed as a tag automatically; it isn't stored with the annotation.
    const storedTags = (existing?.tags ?? []).filter((tag) => tag !== defaults.dataset);
    const isUpToDate =
      existing?.name === name &&
      existing.description === description &&
      storedTags.length === tags.length &&
      tags.every((tag) => storedTags.includes(tag)) &&
      isFinished === archived;
    if (isUpToDate) continue;
    if (isFinished) await api(`/annotations/Explorational/${id}/reopen`, "PATCH");
    await api(`/annotations/Explorational/${id}/edit`, "PATCH", { name, tags });
    if (existing?.description !== description)
      await setAnnotationDescription(await api(`/annotations/${id}/info`), description);
    if (archived)
      await api(`/annotations/Explorational/${id}/finish?timestamp=${Date.now()}`, "PATCH");
    console.log(`Updated ${archived ? "archived" : "open"} annotation ${name}`);
  }
}

const output = path.resolve(root, values.output);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify({ projectName, taskId: task.id }, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, output)}`);
