import { sleep } from "libs/utils";
import { location } from "libs/window";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import {
  FakeLayerRegistrationIframes,
  getLandmarkNml,
  mockBuildInfoRequest,
  readStoredLandmarks,
} from "test/helpers/layer_registration_fake_iframes";
import { handleCrossOriginApiMessage } from "viewer/api/cross_origin_api";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import Store from "viewer/store";
import { getLandmarksFromTrees } from "viewer/view/layer_registration/helpers/layer_registration_helpers";
import {
  getLandmarkIframeLayerName,
  getLayerRegistrationLandmarkIframeUrl,
  isLayerRegistrationFixedLandmarkIframe,
} from "viewer/view/layer_registration/layer_registration_protocol";
import type { IframeWindow } from "viewer/view/layer_registration/workspace/layer_registration_iframe_bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const FIXED_SIDE_PATH = ["color_2", "color_1 landmarks"];
const MOVING_SIDE_PATH = ["color_2", "color_2 landmarks"];

function getTreeCount() {
  return enforceSkeletonTracing(Store.getState().annotation).trees.size();
}

// In these tests, the WEBKNOSSOS instance of the test plays the hidden annotation iframe, which
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

  afterEach(() => {
    location.search = "";
  });

  it("passes layer names with special characters to the landmark iframe in its URL", () => {
    const layerName = "color 2 & more+";
    const url = getLayerRegistrationLandmarkIframeUrl(Store.getState().dataset, "fixed", layerName);
    location.search = new URL(url, location.origin).search;

    expect(getLandmarkIframeLayerName()).toBe(layerName);
    expect(isLayerRegistrationFixedLandmarkIframe()).toBe(true);
  });

  it("holds back commands until the iframe sent init, because it would drop them", async () => {
    const pageWindow = iframes.mount("annotation", handleCrossOriginApiMessage);
    const groupIdPromise = iframes.bridge.sendMessage(
      "annotation",
      "ensureTreeGroupPath",
      FIXED_SIDE_PATH,
    );
    await sleep(10);
    expect(iframes.sentMessages.annotation).toEqual([]);

    pageWindow.postMessage({ type: "init" }, "*");
    const groupId = await groupIdPromise;
    expect(
      await iframes.bridge.sendMessage("annotation", "findTreeGroupPath", FIXED_SIDE_PATH),
    ).toBe(groupId);
  });

  it("keeps the landmarks of each layer pair and side in their own tree group", async () => {
    iframes.mountReady("annotation", handleCrossOriginApiMessage);
    const { sendMessage } = iframes.bridge;
    const treeCountBefore = getTreeCount();
    // Reading must not create groups for layers without landmarks.
    expect(
      await sendMessage("annotation", "findTreeGroupPath", ["color_3", "color_1 landmarks"]),
    ).toBe(null);
    const fixedGroupId = await sendMessage("annotation", "ensureTreeGroupPath", FIXED_SIDE_PATH);
    // Asking again must not create a second group with the same name.
    expect(await sendMessage("annotation", "ensureTreeGroupPath", FIXED_SIDE_PATH)).toBe(
      fixedGroupId,
    );
    // Only the parent group of the moving side exists so far.
    expect(await sendMessage("annotation", "findTreeGroupPath", MOVING_SIDE_PATH)).toBe(null);
    const movingGroupId = await sendMessage("annotation", "ensureTreeGroupPath", MOVING_SIDE_PATH);
    expect(fixedGroupId).not.toBe(movingGroupId);

    const fixedLandmarks = [
      { pairId: 1, position: [1, 2, 3] },
      { pairId: 2, position: [4, 5, 6] },
    ] as const;
    const movingLandmarks = [{ pairId: 1, position: [7, 8, 9] }] as const;
    await sendMessage(
      "annotation",
      "replaceTreesInGroup",
      getLandmarkNml([...fixedLandmarks]),
      fixedGroupId,
    );
    await sendMessage(
      "annotation",
      "replaceTreesInGroup",
      getLandmarkNml([...movingLandmarks]),
      movingGroupId,
    );
    // The next sync replaces the landmarks of one side only.
    await sendMessage(
      "annotation",
      "replaceTreesInGroup",
      getLandmarkNml([fixedLandmarks[1]]),
      fixedGroupId,
    );

    expect(readStoredLandmarks(FIXED_SIDE_PATH)).toEqual([fixedLandmarks[1]]);
    expect(readStoredLandmarks(MOVING_SIDE_PATH)).toEqual(movingLandmarks);
    // The other trees of the annotation are kept.
    expect(getTreeCount()).toBe(treeCountBefore + 2);

    // The page reads the landmarks of one side in the same format.
    const nmlString = await sendMessage("annotation", "exportTreesAsNmlString", {
      groupId: movingGroupId,
    });
    const exportedLandmarks = getLandmarksFromTrees((await parseNml(nmlString)).trees);
    expect(exportedLandmarks.map(({ pairId, position }) => ({ pairId, position }))).toEqual(
      movingLandmarks,
    );
  });

  it("rejects a command that fails in the iframe instead of waiting for a reply", async () => {
    iframes.mountReady("annotation", handleCrossOriginApiMessage);
    const { sendMessage } = iframes.bridge;
    const groupId = await sendMessage("annotation", "ensureTreeGroupPath", FIXED_SIDE_PATH);
    await sendMessage(
      "annotation",
      "replaceTreesInGroup",
      getLandmarkNml([{ pairId: 1, position: [1, 2, 3] }]),
      groupId,
    );

    // @ts-expect-error The command doesn't exist, which is what this checks.
    await expect(sendMessage("annotation", "unknownCommand")).rejects.toThrow("Unsupported");
    // Only the landmark iframes can import landmarks.
    await expect(sendMessage("annotation", "importLandmarks", "<things />")).rejects.toThrow(
      "only available in the layer registration view",
    );
    await expect(
      sendMessage("annotation", "replaceTreesInGroup", "<things><thing", groupId),
    ).rejects.toThrow('"replaceTreesInGroup" failed');
    // A broken NML must not delete the stored landmarks.
    expect(readStoredLandmarks(FIXED_SIDE_PATH)).toEqual([{ pairId: 1, position: [1, 2, 3] }]);
  });

  it("only runs its commands for a page of the same origin and replies only to it", async () => {
    const otherIframes = new FakeLayerRegistrationIframes();
    otherIframes.mountReady("annotation", handleCrossOriginApiMessage, "https://other.test");
    await expect(
      otherIframes.bridge.sendMessage("annotation", "exportTreesAsNmlString"),
    ).rejects.toThrow("only available to pages of the same origin");

    const replyTargetOrigins: string[] = [];
    iframes.mountReady("annotation", (event) =>
      handleCrossOriginApiMessage({
        ...event,
        source: {
          postMessage: (message, targetOrigin) => {
            replyTargetOrigins.push(targetOrigin);
            event.source.postMessage(message, targetOrigin);
          },
        },
      }),
    );
    await iframes.bridge.sendMessage("annotation", "exportTreesAsNmlString");
    expect(replyTargetOrigins).toEqual([location.origin]);
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

  it("rejects a command if the iframe doesn't send init in time", async () => {
    const iframesWithShortTimeout = new FakeLayerRegistrationIframes(50);
    // E.g. an iframe that can't load the annotation.
    const pageWindow = iframesWithShortTimeout.mount("annotation", handleCrossOriginApiMessage);
    await expect(
      iframesWithShortTimeout.bridge.sendMessage("annotation", "exportTreesAsNmlString"),
    ).rejects.toThrow("did not finish loading");
    expect(iframesWithShortTimeout.sentMessages.annotation).toEqual([]);

    // An init that arrives later still lets the next commands through.
    pageWindow.postMessage({ type: "init" }, "*");
    await expect(
      iframesWithShortTimeout.bridge.sendMessage("annotation", "exportTreesAsNmlString"),
    ).resolves.toContain("<things");
  });

  it("rejects a command whose reply gets lost", async () => {
    const iframesWithShortTimeout = new FakeLayerRegistrationIframes(20);
    // E.g. an iframe that reloads while the command is running.
    iframesWithShortTimeout.mountReady("annotation", () => {});
    await expect(iframesWithShortTimeout.bridge.sendMessage("annotation", "save")).rejects.toThrow(
      "did not reply",
    );
  });

  it("rejects the running commands of an iframe that reloads and waits for its next init", async () => {
    // E.g. the user reloads the annotation iframe while it saves, so "save" gets no reply.
    const pageWindow = iframes.mount("annotation", (event) =>
      event.data.type === "save" ? null : handleCrossOriginApiMessage(event),
    );
    pageWindow.postMessage({ type: "init" }, "*");
    const savePromise = iframes.bridge.sendMessage("annotation", "save");
    await sleep(10);

    iframes.bridge.handleIframeReload("annotation");
    await expect(savePromise).rejects.toThrow('reloaded before it replied to "save"');

    const exportPromise = iframes.bridge.sendMessage("annotation", "exportTreesAsNmlString");
    await sleep(10);
    expect(iframes.sentCommandTypes("annotation")).toEqual(["save"]);
    pageWindow.postMessage({ type: "init" }, "*");
    await expect(exportPromise).resolves.toContain("<things");
  });

  it("only accepts commands from the landmark iframes and save states from the annotation iframe", async () => {
    const pageAsSeenByAnnotationIframe = iframes.mount("annotation", () => {});
    const pageAsSeenByMovingIframe = iframes.mount("moving", () => {});
    const sendCommandAndSaveState = (pageWindow: IframeWindow, saveState: string) => {
      pageWindow.postMessage({ type: "layerRegistrationCommand", command: "toggleTransform" }, "*");
      pageWindow.postMessage(
        { type: "layerRegistrationAnnotationIframeSaveState", saveState },
        "*",
      );
    };
    sendCommandAndSaveState(pageAsSeenByAnnotationIframe, "unsaved");
    sendCommandAndSaveState(pageAsSeenByMovingIframe, "saving");
    await sleep(10);

    expect(iframes.landmarkIframeCommands).toEqual([["moving", "toggleTransform"]]);
    expect(iframes.annotationIframeSaveStates).toEqual(["unsaved"]);
  });

  it("ignores messages from windows that are not one of its iframes", async () => {
    const iframesWithShortTimeout = new FakeLayerRegistrationIframes(50);
    iframesWithShortTimeout.mountReady("annotation", () => {});
    const savePromise = iframesWithShortTimeout.bridge.sendMessage("annotation", "save");
    await sleep(10);
    // E.g. a browser extension or another page that posts messages to this window.
    const [{ messageId }] = iframesWithShortTimeout.sentMessages.annotation;
    iframesWithShortTimeout.bridge.handleMessage(
      {
        source: { postMessage: () => {} },
        origin: location.origin,
        data: { type: "ack", messageId },
      },
      { onLandmarkIframeCommand: () => {}, onAnnotationIframeSaveState: () => {} },
    );

    await expect(savePromise).rejects.toThrow("did not reply");
  });

  it("ignores messages of an iframe that shows a page of another origin", async () => {
    // E.g. the iframe was redirected to a SSO login page. It keeps its window.
    const otherOrigin = "https://login.test";
    const iframesWithShortTimeout = new FakeLayerRegistrationIframes(50);
    const pageWindow = iframesWithShortTimeout.mount("annotation", () => {});
    iframesWithShortTimeout.postFromOtherOrigin("annotation", otherOrigin, { type: "init" });
    const savePromise = iframesWithShortTimeout.bridge.sendMessage("annotation", "save");
    await sleep(10);
    expect(iframesWithShortTimeout.sentMessages.annotation).toEqual([]);

    pageWindow.postMessage({ type: "init" }, "*");
    await sleep(10);
    const [{ messageId }] = iframesWithShortTimeout.sentMessages.annotation;
    iframesWithShortTimeout.postFromOtherOrigin("annotation", otherOrigin, {
      type: "ack",
      messageId,
    });
    iframesWithShortTimeout.postFromOtherOrigin("annotation", otherOrigin, {
      type: "layerRegistrationAnnotationIframeSaveState",
      saveState: "saved",
    });

    await expect(savePromise).rejects.toThrow("did not reply");
    expect(iframesWithShortTimeout.annotationIframeSaveStates).toEqual([]);
  });
});
