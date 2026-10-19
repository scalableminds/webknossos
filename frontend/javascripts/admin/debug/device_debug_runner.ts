// Runs a list of experiments step by step and persists the progress to localStorage
// before each step. If the page crashes, the step that was running is known when the
// page is opened again, and the run continues with the next experiment.

const RUN_STORAGE_KEY = "wkDeviceDebugRunV2";

// Waiting before each step gives the browser time to persist the progress
// before a potential crash.
const PRE_STEP_DELAY_MS = 300;
// Chrome reports a lost context asynchronously, so give it some time after each GPU step.
const CONTEXT_LOSS_POLL_DURATION_MS = 300;
// Chrome may block WebGL for a while after the GPU process crashed.
const GPU_COOLDOWN_MS = 15000;

export type StepStatus = "running" | "passed" | "failed" | "crashed" | "skipped";

export type StepResult = {
  index: number;
  experimentId: string;
  label: string;
  status: StepStatus;
  durationMs?: number;
  details?: string;
  error?: string;
  contextLost?: boolean;
  // The browser refused to create a WebGL context (e.g., because it blocks WebGL after a
  // crash). Such experiments are repeated when continuing the run.
  webglUnavailable?: boolean;
  usedHeapMB?: number;
};

export type RunRecord = {
  startedAt: string;
  finishedAt?: string;
  aborted?: boolean;
  userAgent: string;
  steps: StepResult[];
  // Errors etc. which happened outside of a step's own error handling.
  events: string[];
};

// Results of earlier experiments of the run, so that later experiments can adapt.
export type PreviousResults = {
  didFail(experimentId: string): boolean;
  didPass(experimentId: string): boolean;
};

export type ExperimentContext = PreviousResults & {
  // Runs a step. If it fails, the rest of the experiment is not executed.
  step<T>(label: string, fn: (setDetails: (details: string) => void) => T | Promise<T>): Promise<T>;
  // Subsequent steps check whether this context was lost.
  watchContext(gl: WebGL2RenderingContext): void;
  wait(ms: number, statusText: string): Promise<void>;
};

export type Experiment = {
  id: string;
  label: string;
  usesGpu: boolean;
  // Allows to skip experiments whose outcome is already known (e.g., to avoid crashes).
  getSkipReason?: (results: PreviousResults) => string | null;
  run(ctx: ExperimentContext): Promise<void>;
};

class ExperimentStopped extends Error {}
class AbortError extends Error {}
export class WebGlUnavailableError extends Error {}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function persistRecord(record: RunRecord) {
  try {
    localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Persisting is best effort (e.g., the quota might be exceeded).
  }
}

// Returns the record of the last run. If the page died during a step, that step is
// marked as crashed. This is idempotent, since React might call it twice.
export function loadPreviousRecord(): RunRecord | null {
  try {
    const stored = localStorage.getItem(RUN_STORAGE_KEY);
    if (stored == null) return null;
    const record: RunRecord = JSON.parse(stored);
    const runningStep = record.steps.find((step) => step.status === "running");
    if (runningStep != null) {
      runningStep.status = "crashed";
      runningStep.error = "The page died while this step was running.";
      persistRecord(record);
    }
    return record;
  } catch {
    return null;
  }
}

export function clearPreviousRecord() {
  localStorage.removeItem(RUN_STORAGE_KEY);
}

export function createRecord(): RunRecord {
  return {
    startedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    steps: [],
    events: [],
  };
}

function getUsedHeapMB(): number | undefined {
  // performance.memory is only available in Chromium-based browsers.
  const memory = (performance as any).memory;
  return memory != null ? Math.round(memory.usedJSHeapSize / 1024 ** 2) : undefined;
}

function didExperimentCrashGpu(steps: StepResult[]): boolean {
  return steps.some((step) => step.contextLost || step.status === "crashed");
}

// Continues the given record (or starts a new one) with the first experiment which
// has not been run yet.
export async function runExperiments(
  experiments: Experiment[],
  record: RunRecord,
  onUpdate: (record: RunRecord) => void,
  onStatus: (statusText: string | null) => void,
  shouldAbort: () => boolean,
): Promise<void> {
  record.finishedAt = undefined;
  const blockedExperimentIds = new Set(
    record.steps.filter((step) => step.webglUnavailable).map((step) => step.experimentId),
  );
  record.steps = record.steps.filter((step) => !blockedExperimentIds.has(step.experimentId));
  record.aborted = undefined;
  const update = () => {
    persistRecord(record);
    onUpdate({ ...record, steps: [...record.steps], events: [...record.events] });
  };
  const onError = (event: ErrorEvent) => {
    record.events.push(`Uncaught error: ${event.message}`);
    update();
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    record.events.push(`Unhandled rejection: ${String(event.reason)}`);
    update();
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  const wait = async (ms: number, statusText: string) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (shouldAbort()) throw new AbortError();
      onStatus(`${statusText} (${Math.ceil((end - Date.now()) / 1000)} s)`);
      await sleep(Math.min(250, end - Date.now()));
    }
    onStatus(null);
  };

  // Steps of repeated experiments are removed, so the length is not sufficient.
  const getNextIndex = () => Math.max(0, ...record.steps.map((step) => step.index)) + 1;
  const getSteps = (experimentId: string) =>
    record.steps.filter((step) => step.experimentId === experimentId);
  const previousResults: PreviousResults = {
    didFail: (experimentId) =>
      getSteps(experimentId).some(
        (step) => (step.status === "failed" || step.status === "crashed") && !step.webglUnavailable,
      ),
    didPass: (experimentId) => {
      const steps = getSteps(experimentId);
      return steps.length > 0 && steps.every((step) => step.status === "passed");
    },
  };
  let currentExperimentId: string | null = null;
  try {
    for (const experiment of experiments) {
      if (record.steps.some((step) => step.experimentId === experiment.id)) continue;
      currentExperimentId = experiment.id;

      const skipReason = experiment.getSkipReason?.(previousResults);
      if (skipReason != null) {
        record.steps.push({
          index: getNextIndex(),
          experimentId: experiment.id,
          label: skipReason,
          status: "skipped",
        });
        update();
        continue;
      }

      const previousGpuExperimentSteps = [...experiments]
        .reverse()
        .filter((other) => other.usesGpu)
        .map((other) => record.steps.filter((step) => step.experimentId === other.id))
        .find((steps) => steps.length > 0);
      if (
        experiment.usesGpu &&
        previousGpuExperimentSteps != null &&
        didExperimentCrashGpu(previousGpuExperimentSteps)
      ) {
        await wait(GPU_COOLDOWN_MS, "Giving the GPU time to recover from the last crash");
      }

      const watchedContexts: Array<{ gl: WebGL2RenderingContext; isLost: () => boolean }> = [];
      const ctx: ExperimentContext = {
        ...previousResults,
        watchContext(gl) {
          let wasLost = false;
          gl.canvas.addEventListener("webglcontextlost", () => {
            wasLost = true;
          });
          watchedContexts.push({ gl, isLost: () => wasLost || gl.isContextLost() });
        },
        wait,
        async step(label, fn) {
          if (shouldAbort()) throw new AbortError();
          const result: StepResult = {
            index: getNextIndex(),
            experimentId: experiment.id,
            label,
            status: "running",
          };
          record.steps.push(result);
          update();
          // Give the UI a chance to render and the browser a chance to persist the record.
          await nextFrame();
          await sleep(PRE_STEP_DELAY_MS);
          const startTime = performance.now();
          let value: Awaited<ReturnType<typeof fn>> | undefined;
          try {
            value = await fn((details) => {
              result.details = details;
            });
            for (const { gl } of watchedContexts) {
              syncGpu(gl);
            }
            result.status = "passed";
          } catch (error) {
            if (error instanceof AbortError) throw error;
            result.status = "failed";
            result.error = error instanceof Error ? error.message : String(error);
            result.webglUnavailable = error instanceof WebGlUnavailableError;
          }
          result.durationMs = Math.round(performance.now() - startTime);
          for (let elapsed = 0; elapsed < CONTEXT_LOSS_POLL_DURATION_MS; elapsed += 50) {
            if (watchedContexts.some(({ isLost }) => isLost())) break;
            if (watchedContexts.length === 0) break;
            await sleep(50);
          }
          if (watchedContexts.some(({ isLost }) => isLost())) {
            result.status = "failed";
            result.contextLost = true;
            result.error = [
              "The WebGL context was lost. The GPU process probably crashed.",
              result.error,
            ]
              .filter((part) => part != null)
              .join("\n");
          }
          result.usedHeapMB = getUsedHeapMB();
          update();
          if (result.status !== "passed") throw new ExperimentStopped();
          return value as Awaited<ReturnType<typeof fn>>;
        },
      };

      try {
        await experiment.run(ctx);
      } catch (error) {
        if (error instanceof AbortError) throw error;
        if (!(error instanceof ExperimentStopped)) {
          record.events.push(`${experiment.label}: ${String(error)}`);
          update();
        }
      }
    }
  } catch (error) {
    if (!(error instanceof AbortError)) throw error;
    record.aborted = true;
    // Discard the partial results, so that the experiment is repeated when continuing.
    record.steps = record.steps.filter((step) => step.experimentId !== currentExperimentId);
  } finally {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    onStatus(null);
    record.finishedAt = new Date().toISOString();
    update();
  }
}

// Reading back a pixel forces the GPU to finish all pending work. Otherwise, the
// driver might defer work so that a crash would be attributed to a later step.
function syncGpu(gl: WebGL2RenderingContext): void {
  if (gl.isContextLost()) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const error = gl.getError();
  if (error !== gl.NO_ERROR && !gl.isContextLost()) {
    throw new Error(`WebGL error ${error} (0x${error.toString(16)})`);
  }
}
