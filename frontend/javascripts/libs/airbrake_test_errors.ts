// TEMPORARY: Only for manually testing the Airbrake reporting on a dev instance.
// Do not merge. Usage in the browser console:
//   __triggerAirbrakeTestErrors()          // runs all scenarios (one per 1.5 s)
//   __triggerAirbrakeTestErrors("long")    // runs a single scenario (see SCENARIOS)
import ErrorHandling from "libs/error_handling";
import { escalateErrorAction } from "viewer/model/actions/actions";
import { Store } from "viewer/singletons";

// Each run uses another id so that Airbrake's debounce filter (drops identical errors that are
// reported within 1 s) doesn't swallow errors and the tails of the messages differ.
let runCounter = 0;

function longUrl(runId: string, length: number) {
  const base =
    "https://data-humerus.webknossos.org/data/datasets/6ad41776a6c4c798e2c95330/layers/segmentation/agglomerates/";
  return `${base}${"a".repeat(Math.max(0, length - base.length - runId.length))}${runId}`;
}

type Scenario = {
  description: string;
  run: (runId: string) => void;
};

const SCENARIOS: Record<string, Scenario> = {
  shortUnhandledRejection: {
    description:
      "Unhandled rejection with a short message (< 80 chars). Expect: one error, no OriginalError.",
    run: (runId) => {
      void Promise.reject(new TypeError(`Failed to fetch (${runId})`));
    },
  },
  longUnhandledRejection: {
    description:
      "Unhandled rejection with a ~300 char message that only differs at the end. Expect: message cut to 80 chars + a second OriginalError with the full message. Runs 2x (different tail) => should be ONE group.",
    run: (runId) => {
      void Promise.reject(new TypeError(`Failed to fetch - Url: ${longUrl(runId, 300)}`));
    },
  },
  veryLongUnhandledRejection: {
    description:
      "Unhandled rejection with a ~3000 char message. Expect: OriginalError is cut at 1024 chars by the Airbrake notifier.",
    run: (runId) => {
      void Promise.reject(new TypeError(`Failed to fetch - Url: ${longUrl(runId, 3000)}`));
    },
  },
  longWithHugeParams: {
    description:
      "notifyWithPrefix with a ~300 char message and a huge param (> 64 kB), which makes the notifier shrink the string limits of params. Expect: the full message is still visible in OriginalError (before the PR it was only in the params and cut).",
    run: (runId) => {
      ErrorHandling.notifyWithPrefix(
        new TypeError(`Failed to fetch - Url: ${longUrl(runId, 300)}`),
        "Test with huge params: ",
        { hugeParam: "x".repeat(200_000) },
      );
    },
  },
  nonErrorRejection: {
    description:
      "Unhandled rejection with a non-Error reason (JSON stringified), ~200 chars. Expect: prefixed + OriginalError with the JSON.",
    run: (runId) => {
      void Promise.reject({ message: `Some server response ${runId}`, details: "d".repeat(200) });
    },
  },
  plainNotifyLong: {
    description:
      "Plain ErrorHandling.notify with a long message (unchanged code path, for comparison). Expect: no OriginalError.",
    run: (runId) => {
      ErrorHandling.notify(new Error(`Plain notify - Url: ${longUrl(runId, 300)}`));
    },
  },
  // Keep this one last in "all". It really crashes the root saga (like in production),
  // so saving etc. stops working until the page is reloaded.
  rootSagaCrash: {
    description:
      "Escalates a 'Failed to fetch' error so that the root saga crashes (the production case). Expect: 'Root saga crashed: ' + 80 chars of the message + OriginalError with the full message. The annotation stops working afterwards; reload the page.",
    run: (runId) => {
      Store.dispatch(
        escalateErrorAction(new TypeError(`Failed to fetch - Url: ${longUrl(runId, 300)}`)),
      );
    },
  },
};

async function triggerAirbrakeTestErrors(name?: string) {
  const names = name != null ? [name] : Object.keys(SCENARIOS);
  for (const scenarioName of names) {
    const scenario = SCENARIOS[scenarioName];
    if (scenario == null) {
      console.error(
        `Unknown scenario "${scenarioName}". Available: ${Object.keys(SCENARIOS).join(", ")}`,
      );
      return;
    }
    // The long unhandled rejection is run twice with different tails to check the grouping.
    const repetitions = scenarioName === "longUnhandledRejection" ? 2 : 1;
    for (let i = 0; i < repetitions; i++) {
      runCounter++;
      const runId = `run${runCounter}`;
      console.log(`[airbrake test] ${scenarioName} (${runId}): ${scenario.description}`);
      scenario.run(runId);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

(window as any).__triggerAirbrakeTestErrors = triggerAirbrakeTestErrors;
console.log(
  "[airbrake test] Temporary test helper loaded. Run __triggerAirbrakeTestErrors() or __triggerAirbrakeTestErrors(<scenario>). Scenarios:",
  Object.keys(SCENARIOS),
);
