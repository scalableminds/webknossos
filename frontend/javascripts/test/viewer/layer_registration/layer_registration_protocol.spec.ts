import { sleep } from "libs/utils";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import {
  FakeLayerRegistrationIframes,
  getLandmarkNml,
  mockBuildInfoRequest,
  readStoredLandmarks,
} from "test/helpers/layer_registration_iframes";
import { handleCrossOriginApiMessage } from "viewer/api/cross_origin_api";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import Store from "viewer/store";
import { getLandmarks } from "viewer/view/layer_registration/helpers/layer_registration_helpers";
import type { IframeWindow } from "viewer/view/layer_registration/workspace/layer_registration_iframe_bridge";
import { beforeEach, describe, expect, it } from "vitest";

const FIXED_SIDE_PATH = ["color_2", "color_1 landmarks"];
const MOVING_SIDE_PATH = ["color_2", "color_2 landmarks"];

function getTreeCount() {
  return enforceSkeletonTracing(Store.getState().annotation).trees.size();
}

// In these tests, the WEBKNOSSOS instance of the test plays the hidden store iframe, which
// holds the layer registration annotation. The page talks to it through the real bridge and
// the real cross-origin API.
describe("Layer registration protocol", () => {
  let iframes: FakeLayerRegistrationIframes;

  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton", undefined, {
      dontDispatchWkInitialized: true,
    });
    mockBuildInfoRequest(context);
    iframes = new FakeLayerRegistrationIframes();
  });

  it("holds back commands until the iframe sent init, because it would drop them", async () => {
    const pageWindow = iframes.mount("store", handleCrossOriginApiMessage);
    const groupIdPromise = iframes.bridge.sendMessage(
      "store",
      "ensureTreeGroupPath",
      FIXED_SIDE_PATH,
    );
    await sleep(10);
    expect(iframes.sentMessages.store).toEqual([]);

    pageWindow.postMessage({ type: "init" }, "*");
    const groupId = await groupIdPromise;
    expect(await iframes.bridge.sendMessage("store", "findTreeGroupPath", FIXED_SIDE_PATH)).toBe(
      groupId,
    );
  });

  it("keeps the landmarks of each layer pair and side in their own tree group", async () => {
    iframes.mountReady("store", handleCrossOriginApiMessage);
    const { sendMessage } = iframes.bridge;
    const treeCountBefore = getTreeCount();
    // Reading must not create groups for layers without landmarks.
    expect(await sendMessage("store", "findTreeGroupPath", ["color_3", "color_1 landmarks"])).toBe(
      null,
    );
    const fixedGroupId = await sendMessage("store", "ensureTreeGroupPath", FIXED_SIDE_PATH);
    // Asking again must not create a second group with the same name.
    expect(await sendMessage("store", "ensureTreeGroupPath", FIXED_SIDE_PATH)).toBe(fixedGroupId);
    // Only the parent group of the moving side exists so far.
    expect(await sendMessage("store", "findTreeGroupPath", MOVING_SIDE_PATH)).toBe(null);
    const movingGroupId = await sendMessage("store", "ensureTreeGroupPath", MOVING_SIDE_PATH);
    expect(fixedGroupId).not.toBe(movingGroupId);

    const fixedLandmarks = [
      { pairId: 1, position: [1, 2, 3] },
      { pairId: 2, position: [4, 5, 6] },
    ] as const;
    const movingLandmarks = [{ pairId: 1, position: [7, 8, 9] }] as const;
    await sendMessage(
      "store",
      "replaceTreesInGroup",
      getLandmarkNml([...fixedLandmarks]),
      fixedGroupId,
    );
    await sendMessage(
      "store",
      "replaceTreesInGroup",
      getLandmarkNml([...movingLandmarks]),
      movingGroupId,
    );
    // The next sync replaces the landmarks of one side only.
    await sendMessage(
      "store",
      "replaceTreesInGroup",
      getLandmarkNml([fixedLandmarks[1]]),
      fixedGroupId,
    );

    expect(readStoredLandmarks(FIXED_SIDE_PATH)).toEqual([fixedLandmarks[1]]);
    expect(readStoredLandmarks(MOVING_SIDE_PATH)).toEqual(movingLandmarks);
    // The other trees of the annotation are kept.
    expect(getTreeCount()).toBe(treeCountBefore + 2);

    // The page reads the landmarks of one side in the same format.
    const nmlString = await sendMessage("store", "exportTreesAsNmlString", {
      groupId: movingGroupId,
    });
    const exportedLandmarks = getLandmarks((await parseNml(nmlString)).trees);
    expect(exportedLandmarks.map(({ pairId, position }) => ({ pairId, position }))).toEqual(
      movingLandmarks,
    );
  });

  it("rejects a command that fails in the iframe instead of waiting for a reply", async () => {
    iframes.mountReady("store", handleCrossOriginApiMessage);
    const { sendMessage } = iframes.bridge;
    const groupId = await sendMessage("store", "ensureTreeGroupPath", FIXED_SIDE_PATH);
    await sendMessage(
      "store",
      "replaceTreesInGroup",
      getLandmarkNml([{ pairId: 1, position: [1, 2, 3] }]),
      groupId,
    );

    // @ts-expect-error The command doesn't exist, which is what this checks.
    await expect(sendMessage("store", "unknownCommand")).rejects.toThrow("Unsupported");
    // Only the worker iframes can import landmarks.
    await expect(sendMessage("store", "importLandmarks", "<things />")).rejects.toThrow(
      "only available in the layer registration view",
    );
    await expect(
      sendMessage("store", "replaceTreesInGroup", "<things><thing", groupId),
    ).rejects.toThrow('"replaceTreesInGroup" failed');
    // A broken NML must not delete the stored landmarks.
    expect(readStoredLandmarks(FIXED_SIDE_PATH)).toEqual([{ pairId: 1, position: [1, 2, 3] }]);
  });

  it("matches the replies to the commands, also if they arrive in another order", async () => {
    const pendingMessages: Array<{ data: any; source: IframeWindow }> = [];
    iframes.mountReady("fixed", (event) => {
      pendingMessages.push(event);
      // Replies to both commands at once, the second one first.
      if (pendingMessages.length === 2) {
        for (const { data, source } of pendingMessages.toReversed()) {
          source.postMessage(
            { type: "ack", messageId: data.messageId, returnValue: data.args[0] },
            "*",
          );
        }
      }
    });

    // The fake iframe answers any command, so a made-up command is enough to check how the
    // replies are matched.
    const results = await Promise.all([
      // @ts-expect-error "echo" is no real command, see above.
      iframes.bridge.sendMessage("fixed", "echo", "first"),
      // @ts-expect-error "echo" is no real command, see above.
      iframes.bridge.sendMessage("fixed", "echo", "second"),
    ]);
    expect(results).toEqual(["first", "second"]);
  });

  it("rejects a command whose reply gets lost", async () => {
    const iframesWithShortTimeout = new FakeLayerRegistrationIframes(20);
    // E.g. an iframe that reloads while the command is running.
    iframesWithShortTimeout.mountReady("store", () => {});
    await expect(iframesWithShortTimeout.bridge.sendMessage("store", "save")).rejects.toThrow(
      "did not reply",
    );
  });

  it("only accepts worker commands from the workers and save states from the store", async () => {
    const storeAsSeenByIframe = iframes.mount("store", () => {});
    const workerAsSeenByIframe = iframes.mount("moving", () => {});
    const sendCommandAndSaveState = (pageWindow: IframeWindow, saveState: string) => {
      pageWindow.postMessage({ type: "layerRegistrationCommand", command: "toggleTransform" }, "*");
      pageWindow.postMessage({ type: "layerRegistrationStoreSavedState", saveState }, "*");
    };
    sendCommandAndSaveState(storeAsSeenByIframe, "unsaved");
    sendCommandAndSaveState(workerAsSeenByIframe, "saving");
    await sleep(10);

    expect(iframes.workerCommands).toEqual([["moving", "toggleTransform"]]);
    expect(iframes.storeSaveStates).toEqual(["unsaved"]);
  });

  it("ignores messages from windows that are not one of its iframes", async () => {
    const iframesWithShortTimeout = new FakeLayerRegistrationIframes(50);
    iframesWithShortTimeout.mountReady("store", () => {});
    const savePromise = iframesWithShortTimeout.bridge.sendMessage("store", "save");
    await sleep(10);
    // E.g. a browser extension or another page that posts messages to this window.
    const [{ messageId }] = iframesWithShortTimeout.sentMessages.store as Array<{
      messageId?: string;
    }>;
    iframesWithShortTimeout.bridge.handleMessage(
      { source: { postMessage: () => {} }, data: { type: "ack", messageId } },
      { onWorkerCommand: () => {}, onStoreSaveState: () => {} },
    );

    await expect(savePromise).rejects.toThrow("did not reply");
  });
});
