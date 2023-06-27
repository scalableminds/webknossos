const madge = require("madge");

const KNOWN_CYCLES = [
  ["types/api_flow_types.ts", "admin/organization/pricing_plan_utils.ts"],
  [
    "oxalis/model/accessors/flycam_accessor.ts",
    "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker.ts",
    "oxalis/store.ts",
    "oxalis/model/reducers/annotation_reducer.ts",
    "oxalis/model/reducers/reducer_helpers.ts",
    "oxalis/model/accessors/tool_accessor.ts",
  ],
  [
    "oxalis/model/accessors/volumetracing_accessor.ts",
    "oxalis/model/accessors/flycam_accessor.ts",
    "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker.ts",
    "oxalis/store.ts",
    "oxalis/model/reducers/annotation_reducer.ts",
    "oxalis/model/reducers/reducer_helpers.ts",
    "oxalis/model/accessors/tool_accessor.ts",
  ],
  [
    "oxalis/model/accessors/volumetracing_accessor.ts",
    "oxalis/model/accessors/flycam_accessor.ts",
    "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker.ts",
    "oxalis/store.ts",
    "oxalis/model/reducers/annotation_reducer.ts",
    "oxalis/model/reducers/reducer_helpers.ts",
  ],
  [
    "oxalis/model/accessors/flycam_accessor.ts",
    "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker.ts",
    "oxalis/store.ts",
    "oxalis/model/reducers/flycam_reducer.ts",
  ],
  [
    "oxalis/model/accessors/volumetracing_accessor.ts",
    "oxalis/model/accessors/flycam_accessor.ts",
    "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker.ts",
    "oxalis/store.ts",
    "oxalis/model/reducers/save_reducer.ts",
    "oxalis/model/reducers/volumetracing_reducer_helpers.ts",
  ],
  [
    "oxalis/model/accessors/volumetracing_accessor.ts",
    "oxalis/model/accessors/flycam_accessor.ts",
    "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker.ts",
    "oxalis/store.ts",
    "oxalis/model/reducers/settings_reducer.ts",
  ],
  [
    "types/schemas/user_settings.schema.ts",
    "oxalis/model/accessors/volumetracing_accessor.ts",
    "oxalis/model/accessors/flycam_accessor.ts",
    "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker.ts",
    "oxalis/store.ts",
    "oxalis/model/reducers/settings_reducer.ts",
  ],
  [
    "types/schemas/user_settings.schema.ts",
    "oxalis/model/accessors/volumetracing_accessor.ts",
    "oxalis/model/accessors/flycam_accessor.ts",
    "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker.ts",
    "oxalis/store.ts",
    "oxalis/model/reducers/skeletontracing_reducer.ts",
  ],
  [
    "oxalis/model/accessors/volumetracing_accessor.ts",
    "oxalis/model/accessors/flycam_accessor.ts",
    "oxalis/model/bucket_data_handling/bucket_picker_strategies/oblique_bucket_picker.ts",
    "oxalis/store.ts",
    "oxalis/model/reducers/volumetracing_reducer.ts",
  ],
  ["admin/organization/upgrade_plan_modal.tsx", "admin/organization/organization_cards.tsx"],
  ["admin/team/edit_team_modal_view.tsx", "admin/team/team_list_view.tsx"],
  [
    "oxalis/geometries/materials/plane_material_factory.ts",
    "oxalis/shaders/main_data_shaders.glsl.ts",
    "oxalis/geometries/plane.ts",
  ],
  [
    "admin/admin_rest_api.ts",
    "admin/api/mesh_v0.ts",
    "admin/api/token.ts",
    "libs/request.ts",
    "admin/datastore_health_check.ts",
  ],
  ["libs/request.ts", "admin/datastore_health_check.ts"],
  ["libs/mjs.ts"],
  ["oxalis/controller/url_manager.ts", "oxalis/model_initialization.ts"],
  [
    "oxalis/view/action-bar/tracing_actions_view.tsx",
    "oxalis/view/action-bar/view_dataset_actions_view.tsx",
  ],
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
  }
  console.log("Success.");
});
