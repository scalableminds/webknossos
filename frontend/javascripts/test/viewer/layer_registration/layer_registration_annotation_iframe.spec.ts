import { sleep } from "libs/utils";
import type { WebknossosTestContext } from "test/helpers/apiHelpers";
import {
  FakeLayerRegistrationIframes,
  getLandmarkNml,
  readStoredLandmarks,
  setupAnnotationIframeWithoutScene,
} from "test/helpers/layer_registration_fake_iframes";
import { handleCrossOriginApiMessage } from "viewer/api/cross_origin_api";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { wkInitializedAction } from "viewer/model/actions/actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Model } from "viewer/singletons";
import Store from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const GROUP_PATH = ["color_2", "color_1 landmarks"];
const OTHER_GROUP_PATH = ["color_2", "color_2 landmarks"];

// The update actions of the save requests from `fromRequest` on.
function getSentActions(context: WebknossosTestContext, fromRequest: number) {
  return context.receivedDataPerSaveRequest
    .slice(fromRequest)
    .flatMap((entries) => entries.flatMap((entry) => entry.actions));
}

function getTreeIdsInGroup(groupId: number): number[] {
  return enforceSkeletonTracing(Store.getState().annotation)
    .trees.values()
    .filter((tree) => tree.groupId === groupId)
    .map((tree) => tree.treeId)
    .toArray();
}

// The annotation iframe of the layer registration page is a viewer without a scene (see
// ViewerCapabilities.hasScene): the controller never creates the scene controller. Sagas that
// need the scene must wait for it with ensureSceneControllerInitialized, otherwise they crash the
// annotation iframe as soon as WEBKNOSSOS is initialized.
describe("Layer registration annotation iframe", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupAnnotationIframeWithoutScene(context);
    Store.dispatch(wkInitializedAction());
    // Gives the sagas that react to the initialization the time to run.
    await sleep(100);
  });

  afterEach(() => {
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("loads no data, because nothing is rendered", () => {
    const layersWithBuckets = Object.values(Model.dataLayers).filter(
      (layer) => layer.cube.buckets.length > 0,
    );
    expect(layersWithBuckets.map((layer) => layer.name)).toEqual([]);
  });

  it("runs the commands of the layer registration page", async () => {
    const iframes = new FakeLayerRegistrationIframes();
    iframes.mountReady("annotation", handleCrossOriginApiMessage);
    const { sendMessage } = iframes.bridge;

    const groupId = await sendMessage("annotation", "ensureTreeGroupPath", GROUP_PATH);
    await sendMessage(
      "annotation",
      "replaceTreesInGroup",
      getLandmarkNml([{ pairId: 1, position: [1, 2, 3] }]),
      groupId,
    );
    expect(await sendMessage("annotation", "exportTreesAsNmlString", { groupId })).toContain(
      "Landmark 1",
    );
    await sendMessage("annotation", "setAnnotationName", "Registration of color_2");

    expect(readStoredLandmarks(GROUP_PATH)).toEqual([{ pairId: 1, position: [1, 2, 3] }]);
    expect(Store.getState().annotation.name).toBe("Registration of color_2");
  });

  it("saves a replaced group in one request and keeps the other trees", async (context: WebknossosTestContext) => {
    const iframes = new FakeLayerRegistrationIframes();
    iframes.mountReady("annotation", handleCrossOriginApiMessage);
    const { sendMessage } = iframes.bridge;
    const groupId = await sendMessage("annotation", "ensureTreeGroupPath", GROUP_PATH);
    const otherGroupId = await sendMessage("annotation", "ensureTreeGroupPath", OTHER_GROUP_PATH);
    await sendMessage(
      "annotation",
      "replaceTreesInGroup",
      getLandmarkNml([
        { pairId: 1, position: [1, 2, 3] },
        { pairId: 2, position: [4, 5, 6] },
      ]),
      groupId,
    );
    await sendMessage(
      "annotation",
      "replaceTreesInGroup",
      getLandmarkNml([{ pairId: 1, position: [9, 9, 9] }]),
      otherGroupId,
    );
    await sendMessage("annotation", "save");
    const replacedTreeIds = getTreeIdsInGroup(groupId);
    const requestCountBefore = context.receivedDataPerSaveRequest.length;

    await sendMessage(
      "annotation",
      "replaceTreesInGroup",
      getLandmarkNml([{ pairId: 2, position: [7, 8, 9] }]),
      groupId,
    );
    await sendMessage("annotation", "save");

    // Deleting and adding are saved together, so the server never has the group without its
    // landmarks.
    expect(context.receivedDataPerSaveRequest.length).toBe(requestCountBefore + 1);
    const actions = getSentActions(context, requestCountBefore);
    expect(
      actions.flatMap((action) => (action.name === "deleteTree" ? [action.value.id] : [])),
    ).toEqual(replacedTreeIds);
    expect(
      actions.flatMap((action) =>
        action.name === "createTree"
          ? [{ name: action.value.name, groupId: action.value.groupId }]
          : [],
      ),
    ).toEqual([{ name: "Landmark 2", groupId }]);
    expect(
      actions.flatMap((action) => (action.name === "createNode" ? [action.value.position] : [])),
    ).toEqual([[7, 8, 9]]);
  });
});
