import { sleep } from "libs/utils";
import { location } from "libs/window";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import {
  FakeLayerRegistrationIframes,
  FakeWorker,
  getLandmarkNml,
  mockBuildInfoRequest,
} from "test/helpers/layer_registration_iframes";
import { handleCrossOriginApiMessage } from "viewer/api/cross_origin_api";
import Constants, { type Vector3 } from "viewer/constants";
import { handleCreateNodeFromGlobalPosition } from "viewer/controller/combinations/skeleton_handlers";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { Toolkit } from "viewer/model/accessors/tool_accessor";
import { dispatchUndoAsync } from "viewer/model/actions/save_actions";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import Store from "viewer/store";
import {
  getLandmarkColor,
  getLandmarkPairId,
  getLandmarksFromTrees,
} from "viewer/view/layer_registration/helpers/layer_registration_helpers";
import { applyLayerRegistrationWorkerSettings } from "viewer/view/layer_registration/layer_registration_worker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stored landmarks with the cases that the import handles: a tree without a pair id in its name
// (e.g. stored before pair ids existed) and a tree without nodes.
const STORED_LANDMARKS_NML = `<things>
  <thing id="1" name="Landmark 3" color.r="1" color.g="0" color.b="0" color.a="1">
    <nodes><node id="1" x="1" y="1" z="1" /></nodes><edges />
  </thing>
  <thing id="2" name="Tree from an old version" color.r="1" color.g="0" color.b="0" color.a="1">
    <nodes><node id="2" x="2" y="2" z="2" /></nodes><edges />
  </thing>
  <thing id="3" name="Landmark 5" color.r="1" color.g="0" color.b="0" color.a="1">
    <nodes /><edges />
  </thing>
  <thing id="4" name="Landmark 1" color.r="1" color.g="0" color.b="0" color.a="1">
    <nodes><node id="3" x="3" y="3" z="3" /></nodes><edges />
  </thing>
</things>`;

// Where the layer of the worker has data, according to the mocked data store.
const DATA_POSITION: Vector3 = [12, 34, 56];

function mockFindDataRequest({ mocks }: WebknossosTestContext) {
  const receiveJSON = vi.mocked(mocks.Request.receiveJSON);
  const otherRequests = receiveJSON.getMockImplementation();
  receiveJSON.mockImplementation((url, options) =>
    url.includes("/findData")
      ? Promise.resolve({ position: DATA_POSITION, mag: [1, 1, 1] })
      : (otherRequests?.(url, options) ?? Promise.resolve()),
  );
}

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
    // The URL of a worker iframe. Set before the setup, because the viewer reads its
    // capabilities from the URL only once.
    location.search = "?layerRegistrationWorker=color";
    await setupWebknossosForTesting(context, "skeleton");
    mockBuildInfoRequest(context);
    mockFindDataRequest(context);
    // Like the controller does after the annotation was loaded.
    await applyLayerRegistrationWorkerSettings();
    iframes = new FakeLayerRegistrationIframes();
    iframes.mountReady("fixed", handleCrossOriginApiMessage);
  });

  afterEach(() => {
    location.search = "";
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("shows only its own layer, offers only the landmark tools and moves to data", () => {
    const { datasetConfiguration, userConfiguration, flycam } = Store.getState();
    expect(datasetConfiguration.layers.color.isDisabled).toBe(false);
    expect(datasetConfiguration.layers.segmentation.isDisabled).toBe(true);
    expect(datasetConfiguration.nativelyRenderedLayerName).toBe("color");
    expect(userConfiguration.activeToolkit).toBe(Toolkit.LANDMARKS);
    expect(userConfiguration.centerNewNode).toBe(false);
    expect(getPosition(flycam)).toEqual(DATA_POSITION);
  });

  it("doesn't store its forced settings in the user's account", async ({
    mocks,
  }: WebknossosTestContext) => {
    await sleep(Constants.SETTING_SAVE_DEBOUNCE_MS + 200);
    // Loading the settings at the start is a POST, storing them a PUT.
    const storedSettingsUrls = vi
      .mocked(mocks.Request.sendJSONReceiveJSON)
      .mock.calls.filter(([_url, options]) => options?.method === "PUT")
      .map(([url]) => url);
    expect(storedSettingsUrls).toEqual([]);
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

  // The tests of the layer registration page use FakeWorker instead of real workers.
  // The goal is to test the FakeWorker behaving correctly.
  it("imports and exports landmarks like the FakeWorker of the page tests", async () => {
    iframes.mountReady("moving", new FakeWorker().handleMessage);
    const { sendMessage } = iframes.bridge;
    const [realWorkerLandmarks, fakeWorkerLandmarks] = await Promise.all(
      (["fixed", "moving"] as const).map(async (side) => {
        await sendMessage(side, "importLandmarks", STORED_LANDMARKS_NML);
        const nmlString = await sendMessage(side, "exportTreesAsNmlString");
        return getLandmarksFromTrees((await parseNml(nmlString)).trees)
          .filter(({ pairId }) => pairId != null)
          .map(({ pairId, position }) => ({ pairId, position }))
          .toSorted((a, b) => (a.pairId ?? 0) - (b.pairId ?? 0));
      }),
    );

    // The tree without a pair id gets the next one, and the tree without nodes is left out.
    expect(realWorkerLandmarks).toEqual([
      { pairId: 1, position: [3, 3, 3] },
      { pairId: 3, position: [1, 1, 1] },
      { pairId: 4, position: [2, 2, 2] },
    ]);
    expect(fakeWorkerLandmarks).toEqual(realWorkerLandmarks);
  });
});
