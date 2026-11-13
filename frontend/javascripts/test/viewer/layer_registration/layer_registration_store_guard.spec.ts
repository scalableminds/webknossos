import { sleep } from "libs/utils";
import type { WebknossosTestContext } from "test/helpers/apiHelpers";
import { setupStoreWithoutScene } from "test/helpers/layer_registration_iframes";
import {
  sceneControllerInitializedAction,
  wkInitializedAction,
} from "viewer/model/actions/actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import Store from "viewer/store";
import { describe, expect, it, vi } from "vitest";

// The other side of layer_registration_store.spec.ts: without the guard
// ensureSceneControllerInitialized, the sagas that need the scene crash the store. This makes sure
// that the other spec really tests the guard. Dispatching SCENE_CONTROLLER_INITIALIZED without a
// scene controller opens the guard. The ready sagas remember this action for the rest of the
// test file, so this test needs its own file to get proper test isolation.
describe("Layer registration store without the scene guard", () => {
  it<WebknossosTestContext>("crashes the sagas", async (context) => {
    await setupStoreWithoutScene(context);
    // The crash is expected, so its error output is suppressed.
    vi.spyOn(console, "error").mockImplementation(() => {});

    Store.dispatch(sceneControllerInitializedAction());
    Store.dispatch(wkInitializedAction());
    await sleep(100);

    expect(hasRootSagaCrashed()).toBe(true);
  });
});
