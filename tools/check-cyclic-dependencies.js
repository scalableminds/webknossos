const fs = require("node:fs");
const path = require("node:path");
const dpdm = require("dpdm");
const { parseDependencyTree, parseCircular } = dpdm;

const KNOWN_CYCLES = [];

// Web workers are loaded via import.meta.glob / dynamic imports which dpdm
// does not follow from main.tsx. Add them as explicit entry points so that
// cycles in worker dependency graphs are caught, too (cycles there are
// especially problematic since they can break the worker bundles).
const WORKER_DIR = "frontend/javascripts/viewer/workers";
const workerEntries = fs
  .readdirSync(WORKER_DIR)
  .filter((fileName) => fileName.endsWith(".worker.ts"))
  .map((fileName) => path.join(WORKER_DIR, fileName));

parseDependencyTree(["frontend/javascripts/main.tsx", ...workerEntries], {
  /* options, see below */
  extensions: [".ts", ".tsx"],
  transform: true,
  skipDynamicImports: true,
}).then((tree) => {
  const cyclicDependencies = parseCircular(tree);

  const knownCycleStringsSet = new Set(KNOWN_CYCLES.map((el) => el.toString()));
  const knownCycleStrings = Array.from(knownCycleStringsSet);

  if (cyclicDependencies.length > knownCycleStrings.length) {
    const newCycles = cyclicDependencies.filter((el) => !knownCycleStringsSet.has(el.toString()));
    throw new Error(
      `Too many cyclic dependencies (${
        cyclicDependencies.length - knownCycleStrings.length
      } more than previously). Please run "yarn find-cyclic-dependencies" and remove the dependencies you find. The following ones seem to be new (might be too many because known cycles might have changed their structure):\n\n${newCycles
        .map((cycle) => cycle.join(" -> "))
        .join("\n")}\n`,
    );
  } else if (cyclicDependencies.length < knownCycleStrings.length) {
    throw new Error(`Congratulations! Your admirable work removed at least one cyclic dependency from the TypeScript modules. To ensure
      that this improvement is not undone accidentally in the future, please adapt the KNOWN_CYCLES variable in the check-cyclic-dependencies.js
      script. Please set the variable to the following and commit it:
      ${JSON.stringify(cyclicDependencies, null, " ")}
    `);
  }
  console.log("Success.");
});
