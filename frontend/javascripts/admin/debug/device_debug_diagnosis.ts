import {
  EXPERIMENTS,
  SHADER_PROBE_IDS,
  WEBKNOSSOS_SHADER_EXPERIMENT_IDS,
  WORKAROUND_EXPERIMENT_IDS,
} from "./device_debug_experiments";
import type { Experiment, RunRecord, StepResult } from "./device_debug_runner";

export type ExperimentStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "crashed"
  // The browser refused to create a WebGL context, so the experiment could not run.
  | "blocked";

export type ExperimentSummary = {
  experiment: Experiment;
  status: ExperimentStatus;
  steps: StepResult[];
  failedStep?: StepResult;
};

export function summarizeExperiments(record: RunRecord | null): ExperimentSummary[] {
  return EXPERIMENTS.map((experiment) => {
    const steps = record?.steps.filter((step) => step.experimentId === experiment.id) ?? [];
    const failedStep = steps.find((step) => step.status === "failed" || step.status === "crashed");
    let status: ExperimentStatus = "passed";
    if (steps.length === 0) {
      status = "pending";
    } else if (failedStep?.webglUnavailable) {
      status = "blocked";
    } else if (failedStep != null) {
      status = failedStep.status === "crashed" ? "crashed" : "failed";
    } else if (steps.some((step) => step.status === "running")) {
      status = "running";
    }
    return { experiment, status, steps, failedStep };
  });
}

function describeFailure(summary: ExperimentSummary): string {
  const step = summary.failedStep;
  if (step == null) return summary.experiment.label;
  const reason =
    step.status === "crashed"
      ? "the page crashed"
      : step.contextLost
        ? "the GPU process crashed"
        : "it failed";
  return `${summary.experiment.label} (${reason} at step "${step.label}")`;
}

const isBroken = (summary: ExperimentSummary | undefined) =>
  summary != null && (summary.status === "failed" || summary.status === "crashed");

// Derives human-readable conclusions from the experiment results.
export function diagnose(summaries: ExperimentSummary[]): string[] {
  const byId = new Map(summaries.map((summary) => [summary.experiment.id, summary]));
  const conclusions: string[] = [];
  const brokenSummaries = summaries.filter(isBroken);
  // Running out of memory in the memory tests is expected at some point.
  const memoryTestIds = ["jsMemory", "gpuStress"];
  const brokenNonMemorySummaries = brokenSummaries.filter(
    (summary) => !memoryTestIds.includes(summary.experiment.id),
  );

  if (brokenNonMemorySummaries.length === 0) {
    if (summaries.every((summary) => summary.status === "passed")) {
      conclusions.push("All tests passed. No problem was found.");
    }
  }

  const blockedSummaries = summaries.filter((summary) => summary.status === "blocked");
  if (blockedSummaries.length > 0) {
    conclusions.push(
      `These tests could not run, because the browser blocked WebGL after a crash: ${blockedSummaries.map((summary) => summary.experiment.label).join("; ")}. Press Continue later to repeat them.`,
    );
  }

  const trivial = byId.get("probe-trivial");
  if (isBroken(trivial)) {
    conclusions.push(
      `Even a trivial shader fails: ${describeFailure(trivial!)}. WebGL 2 does not work properly in this browser.`,
    );
  }

  const brokenProbes = SHADER_PROBE_IDS.filter((id) => id !== "probe-trivial")
    .map((id) => byId.get(id))
    .filter(isBroken);
  if (brokenProbes.length > 0) {
    conclusions.push(
      `These GLSL features fail on this device: ${brokenProbes.map((summary) => describeFailure(summary!)).join("; ")}.`,
    );
  }

  const samplerArrayProbes = [
    "probe-samplerArraySingle",
    "probe-samplerArrayFloat",
    "probe-samplerArrayUint",
    "probe-samplerArray",
  ].map((id) => byId.get(id));
  const separateSamplers = byId.get("probe-separateSamplers");
  if (samplerArrayProbes.some(isBroken) && separateSamplers?.status === "passed") {
    conclusions.push(
      "Arrays of samplers (e.g., uniform sampler2D textures[4]) break the shader compilation, while separate sampler uniforms work.",
    );
  }

  const shaderSummaries = Object.values(WEBKNOSSOS_SHADER_EXPERIMENT_IDS).map((id) => byId.get(id));
  const brokenShaders = shaderSummaries.filter(isBroken);
  const workingShaders = shaderSummaries.filter((summary) => summary?.status === "passed");
  const color = byId.get(WEBKNOSSOS_SHADER_EXPERIMENT_IDS.color);
  if (brokenShaders.length > 0) {
    conclusions.push(
      `These WEBKNOSSOS shaders fail: ${brokenShaders.map((summary) => describeFailure(summary!)).join("; ")}.`,
    );
    if (workingShaders.length > 0) {
      conclusions.push(
        `These WEBKNOSSOS shaders work: ${workingShaders.map((summary) => summary!.experiment.label).join("; ")}.`,
      );
    }
    if (color?.status === "passed") {
      conclusions.push("The segmentation part of the WEBKNOSSOS shader causes the problem.");
    } else if (isBroken(color)) {
      conclusions.push(
        "Even the shader for a single color layer fails, so the problem is in shader code that is used for all layer types.",
      );
    }
    const stages = new Set(brokenShaders.map((summary) => summary!.failedStep?.label));
    if (stages.size === 1) {
      conclusions.push(
        `All failing WEBKNOSSOS shaders fail at the same step: "${[...stages][0]}".`,
      );
    }
    if (brokenProbes.length === 0 && !isBroken(trivial)) {
      conclusions.push(
        "None of the GLSL feature probes fails. The problem is likely caused by the size or complexity of the WEBKNOSSOS shader, or by a feature which is not covered by the probes.",
      );
    }
  }

  const workarounds = Object.values(WORKAROUND_EXPERIMENT_IDS).map((id) => byId.get(id));
  if (brokenShaders.length > 0 && workarounds.every((summary) => summary?.status === "passed")) {
    conclusions.push(
      "Replacing the sampler arrays with separate sampler uniforms makes the WEBKNOSSOS shaders work. This is a viable workaround.",
    );
  } else if (workarounds.some(isBroken)) {
    conclusions.push(
      `The WEBKNOSSOS shaders also fail without sampler arrays: ${workarounds
        .filter(isBroken)
        .map((summary) => describeFailure(summary!))
        .join("; ")}. So there is at least one other problem.`,
    );
  }

  const realistic = byId.get("realisticSetup");
  if (isBroken(realistic) && brokenShaders.length === 0 && workingShaders.length > 0) {
    conclusions.push(
      `The WEBKNOSSOS shaders work on their own, but ${describeFailure(realistic!)}. This points to memory pressure or the three.js integration.`,
    );
  } else if (isBroken(realistic)) {
    conclusions.push(`${describeFailure(realistic!)}.`);
  }

  for (const id of memoryTestIds) {
    const summary = byId.get(id);
    if (isBroken(summary)) {
      const lastPassed = summary!.steps.filter((step) => step.status === "passed").at(-1);
      conclusions.push(
        `${summary!.experiment.label}: ${lastPassed != null ? `"${lastPassed.label}" was the last step that worked` : "nothing could be allocated"}.`,
      );
    }
  }

  return conclusions;
}
