import { sleep } from "libs/utils";
import type { WebknossosTestContext } from "test/helpers/apiHelpers";
import {
  FakeLayerRegistrationIframes,
  getLandmarkNml,
  readStoredLandmarks,
  setupStoreWithoutScene,
} from "test/helpers/layer_registration_iframes";
import { handleCrossOriginApiMessage } from "viewer/api/cross_origin_api";
import { wkInitializedAction } from "viewer/model/actions/actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { Model } from "viewer/singletons";
import Store from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const GROUP_PATH = ["color_2", "color_1 landmarks"];

// The store iframe of the layer registration page is a viewer without a scene (see
// ViewerCapabilities.hasScene): the controller never creates the scene controller. Sagas that
// need the scene must wait for it with ensureSceneControllerInitialized, otherwise they crash the
// store as soon as WEBKNOSSOS is initialized.
describe("Layer registration store", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupStoreWithoutScene(context);
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
    iframes.mountReady("store", handleCrossOriginApiMessage);
    const { sendMessage } = iframes.bridge;

    const groupId = await sendMessage("store", "ensureTreeGroupPath", GROUP_PATH);
    await sendMessage(
      "store",
      "replaceTreesInGroup",
      getLandmarkNml([{ pairId: 1, position: [1, 2, 3] }]),
      groupId,
    );
    expect(await sendMessage("store", "exportTreesAsNmlString", { groupId })).toContain(
      "Landmark 1",
    );
    await sendMessage("store", "setAnnotationName", "Registration of color_2");

    expect(readStoredLandmarks(GROUP_PATH)).toEqual([{ pairId: 1, position: [1, 2, 3] }]);
    expect(Store.getState().annotation.name).toBe("Registration of color_2");
  });
});
