import { location } from "libs/window";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import {
  FakeLayerRegistrationIframes,
  getLandmarkNml,
  mockBuildInfoRequest,
} from "test/helpers/layer_registration_iframes";
import { handleCrossOriginApiMessage } from "viewer/api/cross_origin_api";
import type { Vector3 } from "viewer/constants";
import { handleCreateNodeFromGlobalPosition } from "viewer/controller/combinations/skeleton_handlers";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { dispatchUndoAsync } from "viewer/model/actions/save_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import Store from "viewer/store";
import {
  getLandmarkColor,
  getLandmarkPairId,
  getLandmarksFromTrees,
} from "viewer/view/layer_registration/helpers/layer_registration_helpers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The landmark trees of the worker, in the order in which they were created.
function getLandmarkTrees() {
  return enforceSkeletonTracing(Store.getState().annotation)
    .trees.values()
    .filter((tree) => getLandmarkPairId(tree.name) != null)
    .map(({ name, color, nodes }) => ({ name, color, nodeCount: nodes.size() }))
    .toArray();
}

// Like a click with the skeleton tool in the XY viewport.
function clickAt(position: Vector3) {
  handleCreateNodeFromGlobalPosition({ rounded: position, floating: position }, "PLANE_XY", false);
}

// In these tests, the WEBKNOSSOS instance of the test plays the worker iframe of the fixed layer.
describe("Layer registration worker", () => {
  let iframes: FakeLayerRegistrationIframes;

  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton");
    // The URL of a worker iframe.
    location.search = "?layerRegistrationWorker=color";
    mockBuildInfoRequest(context);
    // The worker settings create a new tree per click.
    Store.dispatch(updateUserSettingAction("newNodeNewTree", true));
    iframes = new FakeLayerRegistrationIframes();
    iframes.mountReady("fixed", handleCrossOriginApiMessage);
  });

  afterEach(() => {
    location.search = "";
  });

  it("names a clicked landmark after the pair that it completes", async () => {
    const { sendMessage } = iframes.bridge;
    // The stored landmarks of this side, and what the page knows about the other side, which
    // has the pairs 1, 2 and 3.
    await sendMessage(
      "fixed",
      "importLandmarks",
      getLandmarkNml([
        { pairId: 1, position: [1, 1, 1] },
        { pairId: 3, position: [3, 3, 3] },
      ]),
    );
    await sendMessage("fixed", "setLandmarkPairInfo", { openPairIds: [2], otherMaxPairId: 3 });

    clickAt([2, 2, 2]);
    clickAt([4, 4, 4]);
    expect(getLandmarkTrees()).toEqual([
      { name: "Landmark 1", color: getLandmarkColor(1), nodeCount: 1 },
      { name: "Landmark 3", color: getLandmarkColor(3), nodeCount: 1 },
      { name: "Landmark 2", color: getLandmarkColor(2), nodeCount: 1 },
      { name: "Landmark 4", color: getLandmarkColor(4), nodeCount: 1 },
    ]);

    // The page reads the landmarks of the worker like this.
    const nmlString = await sendMessage("fixed", "exportTreesAsNmlString");
    const pairIds = getLandmarksFromTrees((await parseNml(nmlString)).trees).map(
      ({ pairId }) => pairId,
    );
    expect(pairIds.filter((pairId) => pairId != null)).toEqual([1, 3, 2, 4]);
  });

  it("gives the pair id of a deleted landmark to the next click", async () => {
    await iframes.bridge.sendMessage("fixed", "setLandmarkPairInfo", {
      openPairIds: [],
      otherMaxPairId: 0,
    });
    clickAt([1, 1, 1]);
    // Undoing the click (or deleting the node) removes the node, but keeps the empty tree. The
    // name is part of the action that creates the tree, so no undo step leaves a tree with
    // another name behind.
    await dispatchUndoAsync(Store.dispatch);
    expect(getLandmarkTrees()).toEqual([
      { name: "Landmark 1", color: getLandmarkColor(1), nodeCount: 0 },
    ]);

    clickAt([2, 2, 2]);
    expect(getLandmarkTrees().at(-1)).toEqual({
      name: "Landmark 1",
      color: getLandmarkColor(1),
      nodeCount: 1,
    });
  });

  it("exports the landmark pairs with the pair ids as tree ids for the composition wizard", async () => {
    const { sendMessage } = iframes.bridge;
    await sendMessage(
      "fixed",
      "importLandmarks",
      getLandmarkNml([
        { pairId: 5, position: [5, 5, 5] },
        { pairId: 2, position: [2, 2, 2] },
      ]),
    );
    const treeIdsByPairId = enforceSkeletonTracing(Store.getState().annotation)
      .trees.values()
      .flatMap((tree) => {
        const pairId = getLandmarkPairId(tree.name);
        return pairId != null ? [[pairId, tree.treeId] as [number, number]] : [];
      })
      .toArray();

    const nmlString = await sendMessage("fixed", "exportLandmarkPairsAsNml", treeIdsByPairId);
    // The wizard pairs the trees of its two NML files by their sorted tree ids.
    const exportedTrees = (await parseNml(nmlString)).trees.values().toArray();
    expect(
      exportedTrees.map(({ treeId, nodes }) => [
        treeId,
        nodes.values().next().value?.untransformedPosition,
      ]),
    ).toEqual([
      [5, [5, 5, 5]],
      [2, [2, 2, 2]],
    ]);
  });
});
