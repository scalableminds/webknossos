const madge = require("madge");

const KNOWN_CYCLES = [
  [
    "admin/admin_rest_api.ts",
    "admin/api/mesh_v0.ts",
    "admin/api/token.ts",
    "libs/request.ts",
    "admin/datastore_health_check.ts",
  ],
  ["libs/request.ts", "admin/datastore_health_check.ts"],
  ["libs/mjs.ts"],
  ["admin/voxelytics/artifacts_view.tsx", "admin/voxelytics/task_view.tsx"],
  ["admin/voxelytics/task_view.tsx", "admin/voxelytics/statistics_tab.tsx"],
  [
    "admin/voxelytics/task_view.tsx",
    "admin/voxelytics/statistics_tab.tsx",
    "admin/voxelytics/workflow_view.tsx",
    "admin/voxelytics/task_list_view.tsx",
  ],
  ["oxalis/controller/url_manager.ts", "oxalis/model_initialization.ts"],
];

madge("frontend/javascripts/main.tsx", {
  detectiveOptions: {
    ts: {
      skipTypeImports: true,
    },
    tsx: {
      skipTypeImports: true,
    },
  },
}).then((res) => {
  const cyclicDependencies = res.circular({ tsx: { skipTypeImports: true } });
  const knownCycleStrings = new Set(KNOWN_CYCLES.map((el) => el.toString()));
  const newCycles = cyclicDependencies.filter((el) => !knownCycleStrings.has(el.toString()));

  if (newCycles.length > 0) {
    throw new Error(
      `Too many cyclic dependencies. Please run "yarn find-cyclic-dependencies" and remove the dependencies you find. The following ones seem to be new:\n\n${newCycles
        .map((cycle) => cycle.join(" -> "))
        .join("\n")}\n`,
    );
  }
  console.log("Success.");
});
