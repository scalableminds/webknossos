// Recipes deliberately use the live UI and public scripting API. A missing control
// fails the recipe rather than silently replacing a documentation image with the wrong view.
const tooltip = (prefix) => `[data-tooltip-content^=${JSON.stringify(prefix)}]`;
const modal = '[role="dialog"]:visible';
const dropdown = ".ant-dropdown:not(.ant-dropdown-hidden)";

async function show(ctx, selector) {
  const locator = typeof selector === "string" ? ctx.page.locator(selector) : selector;
  await locator.waitFor({ state: "visible" });
  return locator;
}

// fixtures.viewer is the viewer's JSON URL state (position, zoomStep, stateByLayer with
// layer visibility, mappings and precomputed meshes). See fixtures.default.json.
function viewerHash(ctx) {
  const { position, zoomStep = 1, ...state } = ctx.fixtures?.viewer ?? {};
  if (!position) throw new Error("Configure fixtures.viewer.position.");
  return { ...state, position, zoomStep, mode: "orthogonal" };
}

function fixtureMeshSegmentIds(hash) {
  return Object.values(hash.stateByLayer ?? {}).flatMap((layer) =>
    (layer.meshInfo?.meshes ?? []).map((mesh) => String(mesh.segmentId)),
  );
}

async function waitForMeshes(ctx, minimum) {
  await ctx.page.waitForFunction(
    (minimum) => {
      const state = window.webknossos.DEV.store.getState();
      const all = Object.values(state.localSegmentationStateByLayer)
        .flatMap((layer) => Object.values(layer.meshes || {}))
        .flatMap((group) => Object.values(group || {}));
      return all.length >= minimum && all.every((mesh) => !mesh.isLoading);
    },
    minimum,
    { timeout: 120000 },
  );
}

// Skeleton UIs and features show the agglomerate skeletons of the fixture's mesh segments,
// without meshes. All other screenshots show the fixture's precomputed meshes.
function withoutMeshes(hash) {
  const stateByLayer = Object.fromEntries(
    Object.entries(hash.stateByLayer ?? {}).map(([name, { meshInfo, ...layer }]) => [name, layer]),
  );
  return { ...hash, stateByLayer };
}

async function scene(ctx, mode = "hybrid", skeleton = false, persist = false) {
  const fixtureHash = viewerHash(ctx);
  const segmentIds = fixtureMeshSegmentIds(fixtureHash);
  const hash = skeleton ? withoutMeshes(fixtureHash) : fixtureHash;
  await ctx.openViewer({ mode, persist, hash });
  await ctx.page.evaluate(async (position) => {
    const api = await window.webknossos.apiReady();
    const [min, max] = api.data.getBoundingBox(api.data.getLayerNames()[0]);
    if (position.some((value, i) => value < min[i] || value >= max[i])) {
      throw new Error(
        "The screenshot position is outside the dataset. Configure fixtures.viewer.position.",
      );
    }
  }, hash.position);
  await ctx.page.evaluate(async () => {
    const api = await window.webknossos.apiReady();
    api.user.setConfiguration("activeToolkit", "ALL_TOOLS");
    api.user.setConfiguration("newNodeNewTree", false);
    api.user.setConfiguration("tdViewDisplayPlanes", true);
  });
  if (skeleton) {
    if (!segmentIds.length)
      throw new Error(
        "Skeleton screenshots show agglomerate skeletons of the fixture meshes. Configure meshes in fixtures.viewer.stateByLayer.",
      );
    await loadAgglomerateSkeletons(ctx, segmentIds);
    await ctx.page.evaluate(async () => {
      const api = await window.webknossos.apiReady();
      api.tracing.centerTDView();
      api.tracing.rotate3DViewToDiagonal(false);
    });
  } else if (segmentIds.length) {
    await waitForMeshes(ctx, segmentIds.length);
  }
  await ctx.waitForViewer();
}

// Skeletons of the agglomerates whose meshes the fixture loads. Needs the fixture's agglomerate mapping.
async function loadAgglomerateSkeletons(ctx, segmentIds) {
  await ctx.page.waitForFunction(
    () =>
      Object.values(
        window.webknossos.DEV.store.getState().temporaryConfiguration.activeMappingByLayer,
      ).some(
        (mapping) => mapping.mappingType === "AGGLOMERATE" && mapping.mappingStatus === "ENABLED",
      ),
    undefined,
    { timeout: 60000 },
  );
  const existingTrees = await ctx.page.evaluate(async (segmentIds) => {
    const api = await window.webknossos.apiReady();
    const trees = window.webknossos.DEV.store.getState().annotation.skeleton?.trees;
    if (!trees) throw new Error("Agglomerate skeletons need an annotation with a skeleton layer.");
    for (const id of segmentIds) api.tracing.loadAgglomerateSkeletonForSegmentId(BigInt(id));
    return trees.size();
  }, segmentIds);
  await ctx.page.waitForFunction(
    (count) => {
      const trees = window.webknossos.DEV.store.getState().annotation.skeleton.trees;
      return trees.size() >= count && [...trees.values()].every((tree) => tree.nodes.size() > 0);
    },
    existingTrees + segmentIds.length,
    { timeout: 120000 },
  );
}

// Maximizing the 3D tab set also collapses the side panels, so the 3D view fills the screen.
async function maximizeTDView(ctx) {
  await ctx.page
    .locator(".flexlayout__tabset_tabbar_outer")
    .filter({ has: ctx.page.locator(".flexlayout__tab_button_content", { hasText: /^3D$/ }) })
    .locator('button[title="Maximize tab set"]')
    .click();
  await ctx.page.mouse.move(0, 0);
  await ctx.page.evaluate(async () => {
    const api = await window.webknossos.apiReady();
    api.tracing.centerTDView();
    api.tracing.rotate3DViewToDiagonal(false);
  });
  await ctx.waitForViewer();
}

async function tab(ctx, title, selector) {
  await ctx.page
    .locator(".flexlayout__tab_button > .flexlayout__tab_button_content")
    .filter({ hasText: new RegExp(`^${title}$`) })
    .click();
  return show(ctx, selector);
}

async function menu(ctx, item) {
  await ctx.page
    .locator(".action-bar button")
    .filter({ hasText: /^Menu$/ })
    .click();
  await show(ctx, dropdown);
  if (item) {
    await ctx.page
      .locator(dropdown)
      .getByRole("menuitem")
      .filter({ hasText: new RegExp(`^${item}$`) })
      .click();
    return show(ctx, modal);
  }
  return {
    target: ctx.page.locator(dropdown),
    context: ctx.page.locator(".action-bar"),
    padding: 48,
  };
}

async function contextMenu(ctx) {
  const viewport = ctx.page.locator("#screenshot_target_inputcatcher_PLANE_XY");
  await viewport.click({ button: "right" });
  return { target: await show(ctx, ".node-context-menu"), context: viewport, padding: 48 };
}

async function meshes(ctx) {
  await scene(ctx, "view");
  // Precomputed meshes configured in fixtures.viewer were already loaded by scene().
  if (!fixtureMeshSegmentIds(viewerHash(ctx)).length) await computeSampleMeshes(ctx);
  await ctx.page.evaluate(async () => {
    const api = await window.webknossos.apiReady();
    api.tracing.centerTDView();
    api.tracing.rotate3DViewToDiagonal(false);
  });
  await ctx.waitForViewer();
}

// Fallback without configured meshes: compute ad-hoc meshes for segments around the camera.
async function computeSampleMeshes(ctx) {
  await ctx.page.evaluate(async () => {
    const api = await window.webknossos.apiReady();
    const layer = api.data.getVisibleSegmentationLayerName();
    if (!layer)
      throw new Error("The dataset needs a visible segmentation layer for mesh screenshots.");
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
      throw new Error("No non-background segments at the configured scene position.");
  });
  await waitForMeshes(ctx, 1);
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

add("user_interface.png", async (ctx) => {
  await scene(ctx, "hybrid");
  const layoutOf = (selector) =>
    ctx.page
      .locator(selector)
      .locator(
        "xpath=ancestor::div[contains(concat(' ', @class, ' '), ' flexlayout__layout ')][1]",
      );
  const viewport = (id) => ctx.page.locator(`#inputcatcher_${id}`);
  return {
    target: null,
    regions: [
      { target: ".ant-layout-header", color: "#ff1f6a", label: "Toolbar", fontSize: 40 },
      {
        target: layoutOf(".tracing-settings-menu"),
        color: "#ff8a5c",
        label: "Layers and Settings",
      },
      {
        // The viewport tabs plus their XY/YZ/XZ/3D tab bars.
        target: [
          ctx.page.locator(".flexlayout__tab").filter({ has: ctx.page.locator(".inputcatcher") }),
          ctx.page.locator(".flexlayout__tabset_tabbar_outer").filter({
            has: ctx.page.locator(".flexlayout__tab_button_content", {
              hasText: /^(XY|YZ|XZ|3D)$/,
            }),
          }),
        ],
        color: "#4a4ff0",
        label: "Viewports",
        fontSize: 96,
        labels: [
          { target: viewport("PLANE_XY"), text: "XY" },
          { target: viewport("PLANE_YZ"), text: "YZ" },
          { target: viewport("PLANE_XZ"), text: "XZ" },
          { target: viewport("TDView"), text: "3D" },
        ],
      },
      {
        target: layoutOf("#dataset-info-tab"),
        color: "#16c7e0",
        label: "Dataset and Object Info",
        fontSize: 56,
      },
    ],
  };
});
for (const name of ["main_ui.png", "screenshot_volume.png"]) {
  add(name, async (ctx) => {
    await scene(ctx, "hybrid");
  });
}
add("skeleton_annotations.png", async (ctx) => {
  await scene(ctx, "skeleton", true);
  await maximizeTDView(ctx);
});
add("screenshot_skeletons.png", async (ctx) => {
  await scene(ctx, "skeleton", true);
});
for (const name of ["skeleton_tree_list.png", "tracing_ui_tree_visibility.jpeg"]) {
  add(name, async (ctx) => {
    await scene(ctx, "skeleton", true);
    const treeList = await tab(ctx, "Skeleton", "#tree-list");
    if (name === "tracing_ui_tree_visibility.jpeg") {
      return {
        target: treeList,
        highlights: [
          treeList.locator(`${tooltip("Toggle Visibility of All Trees")} button`),
          treeList.locator(`${tooltip("Toggle Visibility of Inactive Trees")} button`),
        ],
      };
    }
    return treeList;
  });
}
add("shuffle_tree_colors.png", async (ctx) => {
  await scene(ctx, "skeleton", true);
  await tab(ctx, "Skeleton", "#tree-list");
  await ctx.page.locator(`#tree-list ${tooltip("More actions")}`).click();
  return {
    target: await show(ctx, dropdown),
    context: ctx.page.locator("#tree-list"),
    padding: 48,
  };
});
for (const name of ["context_menu.png", "context_menu.jpeg", "skeleton_context_menu.png"]) {
  add(name, async (ctx) => {
    await scene(ctx, "hybrid", name === "skeleton_context_menu.png");
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
    const segmentList = await tab(ctx, "Segments", "#segment-list");
    if (name === "segments_tab.jpeg") {
      await segmentList.locator(tooltip("Configure mesh computation")).click();
      const settings = await show(ctx, ".ant-popover:visible");
      return {
        target: settings,
        context: [segmentList, ctx.page.locator("#screenshot_target_inputcatcher_TDView")],
        highlights: [settings],
        padding: 48,
      };
    }
    return {
      target: segmentList,
      context: ctx.page.locator("#screenshot_target_inputcatcher_TDView"),
      highlights: [segmentList.locator(".ant-tree-list-holder-inner")],
      padding: 48,
    };
  });
}
add("ui_toolbar_menu.png", async (ctx) => {
  await scene(ctx);
  return menu(ctx);
});
for (const name of ["tracing_ui_download_tooolbar.jpeg", "tracing_ui_merge_1.jpeg"]) {
  add(name, async (ctx) => {
    await scene(ctx, "skeleton", false, true);
    const capture = await menu(ctx);
    const item = name === "tracing_ui_merge_1.jpeg" ? "Merge Annotation" : "Download";
    return {
      ...capture,
      highlights: [
        ctx.page.locator(".action-bar button").filter({ hasText: /^Menu$/ }),
        ctx.page
          .locator(dropdown)
          .getByRole("menuitem")
          .filter({ hasText: new RegExp(`^${item}$`) }),
      ],
    };
  });
}
add("tracing_ui_download.jpeg", async (ctx) => {
  await scene(ctx, "skeleton", true);
  const treeList = await tab(ctx, "Skeleton", "#tree-list");
  const more = treeList.locator(`${tooltip("More actions")} button`);
  await more.click();
  const menu = await show(ctx, dropdown);
  return {
    target: menu,
    context: treeList,
    highlights: [
      more,
      menu.getByRole("menuitem").filter({ hasText: /^Download Visible Trees NML$/ }),
    ],
    padding: 48,
  };
});
for (const [name, item] of [
  ["tracing_ui_merge_2.jpeg", "Merge Annotation"],
  ["zarr_links.jpeg", "Zarr Links"],
]) {
  add(name, async (ctx) => {
    await scene(ctx, "skeleton", false, true);
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
    await scene(ctx, "skeleton", false, true);
    await menu(ctx, "Share");
    const dialog = ctx.page.locator(modal);
    const row = dialog
      .locator(".ant-row")
      .filter({ has: ctx.page.getByText(label, { exact: true }) });
    const highlights = name === "sharing_modal_visibility.jpeg" ? [] : [row];
    if (name === "sharing_modal_editing.png") {
      highlights.push(
        dialog.locator(".ant-row").filter({
          has: ctx.page.getByText("Can users edit simultaneously?", { exact: true }),
        }),
      );
    }
    return { target: dialog, highlights, padding: 48 };
  });
}
add("tracing_ui_import.jpeg", async (ctx) => {
  await scene(ctx, "skeleton", true);
  await tab(ctx, "Skeleton", "#tree-list");
  await ctx.page.locator(`#tree-list ${tooltip("More actions")}`).click();
  await ctx.clickText("Import NML", { exact: true });
  return show(ctx, modal);
});
add("view_modes.png", async (ctx) => {
  await scene(ctx, "skeleton");
  await ctx.page.locator(".action-bar button:has(.anticon-sync)").hover();
  return {
    target: await show(ctx, ".ant-popover:visible"),
    context: ctx.page.locator(".action-bar"),
    highlights: [
      { target: ctx.page.locator(".action-bar button:has(.anticon-sync)"), color: "#cbcaff" },
    ],
    padding: 48,
  };
});
for (const name of ["tracing_ui_flightmode.jpeg", "screenshot_flight_mode.png"]) {
  add(name, async (ctx) => {
    await scene(ctx, "skeleton", true);
    await ctx.page.locator(".action-bar button:has(.anticon-sync)").hover();
    await ctx.page.locator(".ant-popover:visible").getByRole("switch").click();
    await ctx.page.mouse.move(0, 0);
    await ctx.page.locator(".ant-popover:visible").waitFor({ state: "hidden" });
    await ctx.waitForViewer();
  });
}
add("toolkit_dropdown.jpg", async (ctx) => {
  await scene(ctx);
  // Ant Design attaches the dropdown trigger to the badge, not its button.
  await ctx.page.locator(".action-bar .ant-badge.ant-dropdown-trigger").hover();
  return {
    target: await show(ctx, dropdown),
    context: ctx.page.locator(".action-bar"),
    padding: 48,
  };
});

add("save_view_configuration_in_view_mode.png", async (ctx) => {
  await scene(ctx, "view");
  const button = ctx.page.locator(
    `${tooltip("Save the current view configuration as default")} button`,
  );
  return {
    target: button,
    context: [
      ctx.page.locator(".tracing-settings-menu"),
      ctx.page.locator("#screenshot_target_inputcatcher_PLANE_XY"),
    ],
    highlights: [{ target: button, color: "#635bff" }],
    padding: 48,
  };
});
// These figures show specific biological structures, ground truth, mappings,
// or job capabilities. Replacing them with an arbitrary dataset view would
// change their meaning. Capture checked, read-only scene fixtures.
const curatedScenes = ["docs/images/connectome_viewer.jpeg"];

for (const output of curatedScenes) {
  recipes.push(
    recipe(output, async (ctx) => {
      const fixture = ctx.fixtures?.scenes?.[output];
      if (!fixture?.hash?.position || !fixture.description) {
        throw new Error(
          `This figure needs a reviewed scene on the documentation dataset. Add fixtures.scenes[${JSON.stringify(output)}] with description, hash (including position), optional annotationId, selector, hoverSelectors, clickSelectors, and clickTexts. Existing image was not changed.`,
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
          throw new Error("Curated scene must belong to the configured documentation dataset.");
      }, ctx.dataset.id);
      for (const selector of fixture.hoverSelectors ?? []) {
        await show(ctx, selector);
        await ctx.page.locator(selector).hover();
      }
      for (const selector of fixture.clickSelectors ?? []) {
        await show(ctx, selector);
        await ctx.page.locator(selector).click();
      }
      for (const text of fixture.clickTexts ?? []) await ctx.clickText(text, { exact: true });
      await ctx.waitForViewer();
      const target = fixture.selector ? await show(ctx, fixture.selector) : null;
      return fixture.highlights?.length ? { target, highlights: fixture.highlights } : target;
    }),
  );
}

// Plain EM view in a temporary annotation: no segmentation, predictions, mapping or meshes.
function plainHash(ctx, overrides = {}) {
  const { position, zoomStep } = viewerHash(ctx);
  return {
    position,
    zoomStep,
    mode: "orthogonal",
    stateByLayer: { predictions: { isDisabled: true }, segmentation: { isDisabled: true } },
    ...overrides,
  };
}

// Deterministic training boxes distributed across the dataset; the first one is centered at
// the camera. Top-left corners are aligned to `step` (the annotation magnification).
async function boxSampling(ctx, { count, size, step, zoomStep }) {
  await ctx.openViewer({ mode: "skeleton", hash: plainHash(ctx, { zoomStep }) });
  await ctx.page.evaluate(
    async ({ count, size, step }) => {
      const api = await window.webknossos.apiReady();
      const [min, max] = api.data.getBoundingBox("color");
      const center = api.tracing.getCameraPosition();
      let seed = 42;
      const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const colors = [
        [0.1, 0.9, 0.8],
        [0.6, 0.2, 0.6],
        [0.5, 0.9, 0.1],
        [0.1, 0.4, 0.1],
        [0.7, 0.4, 0.9],
        [0.9, 0.7, 0.1],
        [0.2, 0.3, 0.8],
        [0.9, 0.5, 0.3],
      ];
      for (let i = 0; i < count; i++) {
        const topLeft = center.map((value, axis) => {
          const start =
            i === 0
              ? value - size[axis] / 2
              : min[axis] + random() * (max[axis] - min[axis] - size[axis]);
          return Math.floor(start / step[axis]) * step[axis];
        });
        window.webknossos.DEV.store.dispatch({
          type: "ADD_NEW_USER_BOUNDING_BOX",
          id: i + 1,
          center: undefined,
          newBoundingBox: {
            boundingBox: { min: topLeft, max: topLeft.map((value, axis) => value + size[axis]) },
            name: `Bounding box ${i + 1}`,
            color: colors[i % colors.length],
            isVisible: true,
          },
        });
      }
      api.tracing.centerTDView();
    },
    { count, size, step },
  );
  await tab(ctx, "BBoxes", "#bounding-box-tab");
  await ctx.waitForViewer();
}
recipes.push(
  recipe("docs/automation/images/example_box_sampling_neuron_training.jpeg", (ctx) =>
    boxSampling(ctx, { count: 25, size: [85, 85, 32], step: [1, 1, 1], zoomStep: 1 }),
  ),
);
recipes.push(
  recipe("docs/automation/images/example_box_sampling_instance_segm.jpeg", (ctx) =>
    boxSampling(ctx, { count: 20, size: [1024, 1024, 512], step: [16, 16, 8], zoomStep: 16 }),
  ),
);

// The volume layer (with the segmentation as fallback) must stay enabled for these scenes.
const volumeHash = (ctx) => plainHash(ctx, { stateByLayer: { predictions: { isDisabled: true } } });
add("materialize_volume_annotation_icon.jpg", async (ctx) => {
  await ctx.openViewer({ mode: "hybrid", hash: volumeHash(ctx) });
  const header = ctx.page
    .locator(".tracing-settings-menu")
    .getByText("Volume", { exact: true })
    .locator("xpath=ancestor::*[.//span[contains(@class, 'anticon-ellipsis')]][1]");
  await header.locator(".anticon-ellipsis").hover();
  const menu = await show(ctx, dropdown);
  return {
    target: menu,
    context: header,
    highlights: [
      menu
        .getByRole("menuitem")
        .filter({ hasText: /^Merge this volume annotation with its fallback layer$/ }),
    ],
    padding: 24,
  };
});

// Merger mode cannot be enabled while a mapping is locked, so these scenes use no mapping.
async function mergerMode(ctx) {
  await ctx.openViewer({ mode: "hybrid", hash: volumeHash(ctx) });
  await ctx.page.evaluate(async () => {
    const api = await window.webknossos.apiReady();
    api.tracing.setAnnotationTool("SKELETON");
  });
  await ctx.page.getByRole("img", { name: "Merger Mode" }).click();
  // Enabling merger mode first explains it in a dialog.
  await ctx.page.locator(modal).getByRole("button", { name: "Close" }).click();
  await ctx.page.locator(modal).waitFor({ state: "hidden" });
  const materialize = tooltip("Materialize this merger mode annotation into a new dataset.");
  const button = ctx.page.locator(`button${materialize}, ${materialize} button`).first();
  await button.waitFor({ state: "visible" });
  return button;
}
add("start_merger_mode_job_modal_button.jpg", async (ctx) => {
  const button = await mergerMode(ctx);
  // Save first: the runner's final save re-renders the toolbar, which would hide the tooltip.
  await ctx.page.evaluate(async () => {
    await (await window.webknossos.apiReady()).tracing.save();
  });
  // react-tooltip only registers anchors added after mount when their data-tooltip-id changes,
  // so this button (rendered once merger mode is on) needs its attribute re-set to get a tooltip.
  await ctx.page
    .locator(tooltip("Materialize this merger mode annotation into a new dataset."))
    .evaluate((anchor) => {
      const id = anchor.getAttribute("data-tooltip-id");
      anchor.removeAttribute("data-tooltip-id");
      anchor.setAttribute("data-tooltip-id", id);
    });
  await button.hover();
  const hint = ctx.page.getByRole("tooltip").filter({ hasText: /^Materialize this merger mode/ });
  return { target: button, context: await show(ctx, hint), padding: 16 };
});
add("start_merger_mode_job_modal.jpg", async (ctx) => {
  await (await mergerMode(ctx)).click();
  return show(ctx, modal);
});

add("process_dataset.jpg", async (ctx) => {
  await scene(ctx, "view");
  await ctx.page.locator('button[title="Start a processing job using AI"]').hover();
  await show(ctx, dropdown);
});
