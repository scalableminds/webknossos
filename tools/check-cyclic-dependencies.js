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
  ["types/api_flow_types.ts", "admin/organization/pricing_plan_utils.ts"],
  ["libs/mjs.ts"],
  ["oxalis/model/accessors/flycam_accessor.ts", "oxalis/model/reducers/flycam_reducer.ts"],
  ["admin/organization/upgrade_plan_modal.tsx", "admin/organization/organization_cards.tsx"],
  ["admin/team/edit_team_modal_view.tsx", "admin/team/team_list_view.tsx"],
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
      that this improvement is not undone accidentally in the future, please adapt the KNOWN_CYCLES variable in the check-cyclic-dependies.js
      script. Please set the variable to the following and commit it:
      ${JSON.stringify(cyclicDependencies, null, " ")}
    `);
  }
  console.log("Success.");
});
