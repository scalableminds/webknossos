const dpdm = require("dpdm");
const { parseDependencyTree, parseCircular } = dpdm;

const KNOWN_CYCLES = [
  [
    "frontend/javascripts/oxalis/model/accessors/view_mode_accessor.ts",
    "frontend/javascripts/oxalis/model/accessors/flycam_accessor.ts",
  ],
  [
    "frontend/javascripts/oxalis/model/accessors/flycam_accessor.ts",
    "frontend/javascripts/oxalis/model/reducers/flycam_reducer.ts",
  ],
  [
    "frontend/javascripts/oxalis/view/right-border-tabs/tree_hierarchy_view_helpers.ts",
    "frontend/javascripts/oxalis/model/accessors/skeletontracing_accessor.ts",
  ],
  ["frontend/javascripts/libs/request.ts", "frontend/javascripts/admin/datastore_health_check.ts"],
  [
    "frontend/javascripts/admin/rest_api.ts",
    "frontend/javascripts/libs/request.ts",
    "frontend/javascripts/admin/datastore_health_check.ts",
  ],
  [
    "frontend/javascripts/oxalis/view/action-bar/download_modal_view.tsx",
    "frontend/javascripts/oxalis/view/action-bar/starting_job_modals.tsx",
  ],
  [
    "frontend/javascripts/admin/organization/upgrade_plan_modal.tsx",
    "frontend/javascripts/admin/organization/organization_cards.tsx",
  ],
  [
    "frontend/javascripts/admin/task/task_create_form_view.tsx",
    "frontend/javascripts/admin/task/task_create_bulk_view.tsx",
  ],
  [
    "frontend/javascripts/admin/team/team_list_view.tsx",
    "frontend/javascripts/admin/team/edit_team_modal_view.tsx",
  ],
  [
    "frontend/javascripts/dashboard/advanced_dataset/dataset_table.tsx",
    "frontend/javascripts/dashboard/folders/folder_tree.tsx",
  ],
  [
    "frontend/javascripts/oxalis/model_initialization.ts",
    "frontend/javascripts/oxalis/controller/url_manager.ts",
  ],
  [
    "frontend/javascripts/oxalis/geometries/plane.ts",
    "frontend/javascripts/oxalis/geometries/materials/plane_material_factory.ts",
    "frontend/javascripts/oxalis/shaders/main_data_shaders.glsl.ts",
  ],
];
parseDependencyTree("frontend/javascripts/main.tsx", {
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
