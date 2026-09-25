// Recipes deliberately use the live UI and public scripting API. A missing control
// fails the recipe rather than silently replacing a documentation image with the wrong view.
const tooltip = (prefix) => `[data-tooltip-content^=${JSON.stringify(prefix)}]`;
const toolButton = (tool) => `.action-bar label:has(input[value="${tool}"])`;
const modal = '.ant-modal-wrap:not([style*="display: none"]) .ant-modal-content';
const dropdown = ".ant-dropdown:not(.ant-dropdown-hidden)";

async function show(ctx, selector) {
  await ctx.page.waitForSelector(selector, { visible: true });
  return selector;
}

async function scene(ctx, mode = "hybrid", skeleton = false, persist = false) {
  const position = ctx.fixtures?.viewer?.position ?? [3457, 3323, 1204];
  const zoomStep = ctx.fixtures?.viewer?.zoomStep ?? 1;
  await ctx.openViewer({ mode, persist, hash: { position, zoomStep, mode: "orthogonal" } });
  await ctx.page.evaluate(async (position) => {
    const api = await window.webknossos.apiReady();
    const [min, max] = api.data.getBoundingBox(api.data.getLayerNames()[0]);
    if (position.some((value, i) => value < min[i] || value >= max[i])) {
      throw new Error(
        "The screenshot position is outside l4_sample. Configure fixtures.viewer.position.",
      );
    }
  }, position);
  await ctx.page.evaluate(async (addSkeleton) => {
    const api = await window.webknossos.apiReady();
    api.user.setConfiguration("activeToolkit", "ALL_TOOLS");
    api.user.setConfiguration("newNodeNewTree", false);
    api.user.setConfiguration("tdViewDisplayPlanes", true);
    if (addSkeleton) {
      // Small, deterministic demonstration annotation centered within l4_sample.
      // This is an illustrative tracing, not scientific ground truth.
      const center = api.tracing.getCameraPosition();
      for (let treeIndex = 0; treeIndex < 3; treeIndex++) {
        const treeId = api.tracing.createTree();
        api.tracing.setTreeName(
          ["Example dendrite", "Example axon", "Review branch"][treeIndex],
          treeId,
        );
        api.tracing.setTreeColorIndex(treeId, treeIndex + 1);
        for (let i = 0; i < 12; i++) {
          api.tracing.createNode(
            [
              center[0] + (i - 6) * 7,
              center[1] + Math.round(Math.sin(i / 3 + treeIndex) * 20) + treeIndex * 14,
              center[2] + i - 6,
            ],
            { center: false },
          );
        }
        api.tracing.setCommentForNode("Review this branch", api.tracing.getActiveNodeId(), treeId);
      }
      api.tracing.setCameraPosition(center);
      api.tracing.centerTDView();
      api.tracing.rotate3DViewToDiagonal(false);
    }
  }, skeleton);
  await ctx.waitForViewer();
}

async function selectTool(ctx, tool) {
  await ctx.page.evaluate(async (id) => {
    const api = await window.webknossos.apiReady();
    api.tracing.setAnnotationTool(id);
  }, tool);
  await show(ctx, toolButton(tool));
}

async function tab(ctx, title, selector) {
  await ctx.clickText(title, { exact: true });
  return show(ctx, selector);
}

async function menu(ctx, item) {
  await ctx.clickText("Menu", { exact: true });
  await show(ctx, dropdown);
  if (item) {
    await ctx.clickText(item, { exact: true });
    return show(ctx, modal);
  }
  return dropdown;
}

async function contextMenu(ctx) {
  const viewport = await ctx.page.waitForSelector("#screenshot_target_inputcatcher_PLANE_XY", {
    visible: true,
  });
  const box = await viewport.boundingBox();
  await ctx.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  return show(ctx, ".node-context-menu");
}

async function meshes(ctx) {
  await scene(ctx, "view");
  await ctx.page.evaluate(async () => {
    const api = await window.webknossos.apiReady();
    const layer = api.data.getVisibleSegmentationLayerName();
    if (!layer)
      throw new Error("l4_sample needs a visible segmentation layer for mesh screenshots.");
    const center = api.tracing.getCameraPosition();
    const found = new Set();
    for (const offset of [
      [0, 0, 0],
      [20, 0, 0],
      [0, 20, 0],
      [-20, 0, 0],
      [0, -20, 0],
    ]) {
      const seed = center.map((value, axis) => Math.round(value + offset[axis]));
      const id = BigInt(await api.data.getDataValue(layer, seed));
      if (id === 0n || found.has(String(id))) continue;
      found.add(String(id));
      api.tracing.registerSegment(id, seed, undefined, layer);
      api.data.setSegmentColor(
        id,
        [
          [0.9, 0.3, 0.2],
          [0.2, 0.7, 0.9],
          [0.7, 0.4, 0.9],
        ][(found.size - 1) % 3],
        layer,
      );
      api.data.computeMeshOnDemand(id, seed);
      if (found.size === 3) break;
    }
    if (found.size === 0)
      throw new Error("No non-background l4_sample segments at the configured scene position.");
  });
  await ctx.page.waitForFunction(
    () => {
      const state = window.webknossos.DEV.store.getState();
      const all = Object.values(state.localSegmentationStateByLayer)
        .flatMap((layer) => Object.values(layer.meshes || {}))
        .flatMap((group) => Object.values(group || {}));
      return all.length > 0 && all.every((mesh) => !mesh.isLoading);
    },
    { timeout: 120000 },
  );
  await ctx.page.evaluate(async () => {
    const api = await window.webknossos.apiReady();
    api.tracing.centerTDView();
    api.tracing.rotate3DViewToDiagonal(false);
  });
  await ctx.waitForViewer();
}

function recipe(output, capture) {
  return {
    id: output
      .replace(/^docs\//, "")
      .replaceAll("/", "-")
      .replaceAll(".", "-"),
    output,
    capture,
  };
}

export const recipes = [];
const add = (name, capture) => recipes.push(recipe(`docs/images/${name}`, capture));

for (const name of ["main_ui.png", "user_interface.png", "screenshot_volume.png"]) {
  add(name, async (ctx) => {
    await scene(ctx, "hybrid", true);
  });
}
for (const name of ["skeleton_annotations.png", "screenshot_skeletons.png"]) {
  add(name, async (ctx) => {
    await scene(ctx, "skeleton", true);
  });
}
for (const name of ["skeleton_tree_list.png", "tracing_ui_tree_visibility.jpeg"]) {
  add(name, async (ctx) => {
    await scene(ctx, "skeleton", true);
    return tab(ctx, "Skeleton", "#tree-list");
  });
}
add("shuffle_tree_colors.png", async (ctx) => {
  await scene(ctx, "skeleton", true);
  await tab(ctx, "Skeleton", "#tree-list");
  await ctx.page.click(`#tree-list ${tooltip("More actions")}`);
  return show(ctx, dropdown);
});
for (const name of ["context_menu.png", "context_menu.jpeg", "skeleton_context_menu.png"]) {
  add(name, async (ctx) => {
    await scene(ctx, "hybrid", true);
    return contextMenu(ctx);
  });
}
add("mesh_options.jpeg", async (ctx) => {
  await scene(ctx, "view");
  return contextMenu(ctx);
});
add("mesh_3D_viewport.jpeg", async (ctx) => {
  await meshes(ctx);
  return show(ctx, "#screenshot_target_inputcatcher_TDView");
});
for (const name of ["segments_tab.jpeg", "segments_tab2.jpeg"]) {
  add(name, async (ctx) => {
    await meshes(ctx);
    return tab(ctx, "Segments", "#segment-list");
  });
}
add("datalayers.jpeg", async (ctx) => {
  await scene(ctx, "view");
  return show(ctx, ".tracing-settings-menu");
});
add("ui_toolbar_menu.png", async (ctx) => {
  await scene(ctx);
  return show(ctx, ".action-bar");
});
for (const name of ["tracing_ui_download_tooolbar.jpeg", "tracing_ui_merge_1.jpeg"]) {
  add(name, async (ctx) => {
    await scene(ctx, "skeleton", true, true);
    return menu(ctx);
  });
}
for (const [name, item] of [
  ["tracing_ui_download.jpeg", "Download"],
  ["tracing_ui_merge_2.jpeg", "Merge Annotation"],
  ["zarr_links.jpeg", "Zarr Links"],
]) {
  add(name, async (ctx) => {
    await scene(ctx, "skeleton", true, true);
    return menu(ctx, item);
  });
}
for (const [name, label] of [
  ["sharing_modal_visibility.jpeg", "Who can view this annotation?"],
  ["sharing_modal_link.jpeg", "Sharing Link"],
  ["sharing_modal_team.png", "For which teams should this annotation be listed?"],
  ["sharing_modal_editing.png", "Who can edit this annotation?"],
]) {
  add(name, async (ctx) => {
    await scene(ctx, "skeleton", true, true);
    await menu(ctx, "Share");
    await ctx.page.evaluate((label) => {
      const rows = Array.from(document.querySelectorAll(".ant-modal-body .ant-row"));
      const row = rows.find((row) => row.textContent.includes(label));
      if (!row) throw new Error(`Sharing control missing: ${label}`);
      row.dataset.docsCapture = "sharing-section";
    }, label);
    return show(ctx, '[data-docs-capture="sharing-section"]');
  });
}
add("tracing_ui_import.jpeg", async (ctx) => {
  await scene(ctx, "skeleton", true);
  await tab(ctx, "Skeleton", "#tree-list");
  await ctx.page.click(`#tree-list ${tooltip("More actions")}`);
  await ctx.clickText("Import NML", { exact: true });
  return show(ctx, modal);
});
add("view_modes.png", async (ctx) => {
  await scene(ctx, "skeleton");
  await ctx.page.hover('.action-bar button:has([aria-label="appstore"])');
  return show(ctx, dropdown);
});
for (const name of ["tracing_ui_flightmode.jpeg", "screenshot_flight_mode.png"]) {
  add(name, async (ctx) => {
    await scene(ctx, "skeleton", true);
    await ctx.page.hover('.action-bar button:has([aria-label="appstore"])');
    await ctx.clickText("Flight", { exact: true });
    await ctx.waitForViewer();
  });
}
add("toolkit_dropdown.jpg", async (ctx) => {
  await scene(ctx);
  // Toolkit is the only dropdown-trigger button wrapped in an antd badge.
  await ctx.page.hover(".action-bar .ant-badge > button.ant-dropdown-trigger");
  return show(ctx, dropdown);
});

for (const [name, tool] of Object.entries({
  "move-tool": "MOVE",
  "skeleton-tool": "SKELETON",
  "trace-tool": "TRACE",
  "brush-tool": "BRUSH",
  "eraser-tool": "ERASE_BRUSH",
  "fill-tool": "FILL_CELL",
  "quickselect-tool": "QUICK_SELECT",
  "proofreading-tool": "PROOFREAD",
  "measure-tool": "LINE_MEASUREMENT",
  "segment-picker-tool": "VOXEL_PIPETTE",
  "boundingbox-tool": "BOUNDING_BOX",
})) {
  recipes.push(
    recipe(`docs/ui/images/${name}.jpg`, async (ctx) => {
      await scene(ctx);
      // Proofreading can be disabled on local installations, but its rendered icon
      // is still present and can be captured without enabling a mapping.
      if (tool !== "PROOFREAD") await selectTool(ctx, tool);
      return show(ctx, toolButton(tool));
    }),
  );
}

for (const [name, text] of Object.entries({
  "new-tree-modifier": "Create a new Tree",
  "single-node-tree-mode-modifier": "Toggle the Single node Tree",
  "pen-mode-modifier": "When activated, clicking and dragging creates nodes",
})) {
  recipes.push(
    recipe(`docs/skeleton_annotation/images/${name}.jpg`, async (ctx) => {
      await scene(ctx, "skeleton");
      await selectTool(ctx, "SKELETON");
      return show(ctx, tooltip(text));
    }),
  );
}
recipes.push(
  recipe("docs/skeleton_annotation/images/merger-mode-modifier.jpg", async (ctx) => {
    await scene(ctx, "skeleton");
    await selectTool(ctx, "SKELETON");
    return show(ctx, 'button:has([aria-label="Merger Mode"])');
  }),
);
for (const [name, tool, text] of [
  ["new-segment-modifier", "BRUSH", "Create a new segment id"],
  ["brush-size-modifier", "BRUSH", "Change the brush size"],
  ["overwrite-everything-modifier", "BRUSH", "Overwrite everything."],
  ["overwrite-empty-modifier", "BRUSH", "Only overwrite empty areas."],
  ["2d-modifier", "FILL_CELL", "Only perform the Fill operation"],
  ["3d-modifier", "FILL_CELL", "Perform the Fill operation in 3D."],
  ["icon_restricted_floodfill", "FILL_CELL", "When enabled, the floodfill"],
]) {
  recipes.push(
    recipe(`docs/volume_annotation/images/${name}.jpg`, async (ctx) => {
      await scene(ctx);
      await selectTool(ctx, tool);
      return show(ctx, tooltip(text));
    }),
  );
}
recipes.push(
  recipe("docs/volume_annotation/images/interpolation-modifier.jpg", async (ctx) => {
    await scene(ctx);
    await selectTool(ctx, "BRUSH");
    return show(ctx, '.action-bar [data-tooltip-content*="nterpolat"]');
  }),
);

add("save_view_configuration_in_view_mode.png", async (ctx) => {
  await scene(ctx, "view");
  return show(ctx, tooltip("Save the current view configuration as default"));
});
recipes.push(
  recipe("docs/ui/images/ai-analysis-tools.jpg", async (ctx) => {
    await scene(ctx);
    return show(ctx, 'button[title="Start a processing job using AI"]');
  }),
);

// These figures show specific biological structures, ground truth, mappings,
// or job capabilities. Replacing them with an arbitrary dataset view would
// change their meaning. Capture checked, read-only l4_sample scene fixtures.
const curatedScenes = [
  "docs/images/connectome_viewer.jpeg",
  "docs/images/blend-mode-example-additive-bosch-et-al.png",
  "docs/images/blend-mode-example-cover-bosch-et-al.png",
  "docs/images/neuron_segmentation_start.jpeg",
  "docs/images/materialize_volume_annotation_icon.jpg",
  "docs/images/start_merger_mode_job_modal.jpg",
  "docs/images/start_merger_mode_job_modal_button.jpg",
  "docs/images/tracing_ui_obliquemode.jpeg",
  "docs/automation/images/example_box_sampling_neuron_training.jpeg",
  "docs/automation/images/example_box_sampling_instance_segm.jpeg",
  "docs/tutorials/images/tutorial_trainingdata_01_segment_touching_outside_of_box.jpeg",
  "docs/tutorials/images/tutorial_trainingdata_02_final_check.jpeg",
  "docs/tutorials/images/tutorial_trainingdata_03_complete_coverage.jpeg",
  "docs/tutorials/images/tutorial_trainingdata_04_gaps_membrane_within_one_segment.jpeg",
  "docs/tutorials/images/tutorial_trainingdata_05_membranes_unannotated.jpeg",
  "docs/tutorials/images/tutorial_trainingdata_06_cell_geometry.jpeg",
  "docs/tutorials/images/tutorial_trainingdata_07_isolated_voxels.jpeg",
  "docs/tutorials/images/tutorial_trainingdata_08_soma_ground_truth_example.png",
];

for (const output of curatedScenes) {
  recipes.push(
    recipe(output, async (ctx) => {
      const fixture = ctx.fixtures?.scenes?.[output];
      if (!fixture?.hash?.position || !fixture.description) {
        throw new Error(
          `This figure needs a reviewed l4_sample scene. Add fixtures.scenes[${JSON.stringify(output)}] with description, hash (including position), optional annotationId, selector, hoverSelectors, clickSelectors, and clickTexts. Existing image was not changed.`,
        );
      }
      if (fixture.annotationId) {
        if (!/^[a-f0-9]{24}$/.test(fixture.annotationId))
          throw new Error("Invalid scene annotationId");
        await ctx.page.goto(
          `${ctx.baseUrl}/annotations/${fixture.annotationId}#${encodeURIComponent(JSON.stringify(fixture.hash))}`,
        );
        await ctx.waitForViewer();
      } else {
        await ctx.openViewer({ mode: "view", hash: fixture.hash });
      }
      await ctx.page.evaluate((expectedId) => {
        const state = window.webknossos.DEV.store.getState();
        if (state.dataset.id !== expectedId)
          throw new Error(
            "Curated scene must belong to the configured published l4_sample dataset.",
          );
      }, ctx.dataset.id);
      for (const selector of fixture.hoverSelectors ?? []) {
        await show(ctx, selector);
        await ctx.page.hover(selector);
      }
      for (const selector of fixture.clickSelectors ?? []) {
        await show(ctx, selector);
        await ctx.page.click(selector);
      }
      for (const text of fixture.clickTexts ?? []) await ctx.clickText(text, { exact: true });
      await ctx.waitForViewer();
      return fixture.selector ? show(ctx, fixture.selector) : undefined;
    }),
  );
}

add("process_dataset.jpg", async (ctx) => {
  await scene(ctx, "view");
  await ctx.page.hover('button[title="Start a processing job using AI"]');
  await show(ctx, dropdown);
});
