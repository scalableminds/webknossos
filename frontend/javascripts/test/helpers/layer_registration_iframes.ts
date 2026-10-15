import { buildInfo } from "test/fixtures/build_info";
import type { WebknossosTestContext } from "test/helpers/apiHelpers";
import type { Vector3 } from "viewer/constants";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import type { TreeGroup } from "viewer/model/types/tree_types";
import Store from "viewer/store";
import { getLandmarkPairId } from "viewer/view/layer_registration/helpers/layer_registration_helpers";
import type {
  LayerRegistrationCommand,
  SaveState,
} from "viewer/view/layer_registration/layer_registration_protocol";
import {
  IframeBridge,
  type IframeRole,
  type IframeWindow,
} from "viewer/view/layer_registration/workspace/layer_registration_iframe_bridge";
import { vi } from "vitest";

// How an iframe handles the messages of the page, e.g. handleCrossOriginApiMessage.
type IframeMessageHandler = (event: { data: any; source: IframeWindow }) => unknown;

// Like window.postMessage, the message arrives asynchronously.
function deliverLater(deliver: () => unknown) {
  setTimeout(deliver, 0);
}

/** The layer registration page with fake iframes in the same process. Each iframe is a message
 * handler, and the messages between the page and the iframes are delivered like with
 * window.postMessage: asynchronously and with the sending window as source.
 */
export class FakeLayerRegistrationIframes {
  readonly bridge: IframeBridge;
  readonly workerCommands: Array<[IframeRole, LayerRegistrationCommand]> = [];
  readonly storeSaveStates: SaveState[] = [];
  // All messages that the page sent, per iframe.
  readonly sentMessages: Record<IframeRole, Array<{ type: string; args: unknown[] }>> = {
    fixed: [],
    moving: [],
    store: [],
  };
  private readonly windows: Record<IframeRole, IframeWindow | null> = {
    fixed: null,
    moving: null,
    store: null,
  };

  constructor(replyTimeoutMs?: number) {
    this.bridge = new IframeBridge((role) => this.windows[role], "https://wk.test", replyTimeoutMs);
  }

  // Mounts an iframe. Returns its view of the page, through which the iframe sends messages.
  mount(role: IframeRole, handleMessage: IframeMessageHandler): IframeWindow {
    const iframeWindow: IframeWindow = {
      postMessage: (data: any) => {
        this.sentMessages[role].push(data);
        deliverLater(() => handleMessage({ data, source: pageWindow }));
      },
    };
    const pageWindow: IframeWindow = {
      postMessage: (data) =>
        deliverLater(() =>
          this.bridge.handleMessage(
            { source: iframeWindow, data: data as object },
            {
              onWorkerCommand: (side, command) => this.workerCommands.push([side, command]),
              onStoreSaveState: (saveState) => this.storeSaveStates.push(saveState),
            },
          ),
        ),
    };
    this.windows[role] = iframeWindow;
    return pageWindow;
  }

  // Mounts an iframe whose API is ready right away.
  mountReady(role: IframeRole, handleMessage: IframeMessageHandler) {
    this.mount(role, handleMessage).postMessage({ type: "init" }, "*");
  }

  sentCommandTypes(role: IframeRole): string[] {
    return this.sentMessages[role].map(({ type }) => type);
  }
}

type FakeLandmark = { pairId: number; position: Readonly<Vector3> };

// A minimal NML with one tree per landmark, as the workers export it.
export function getLandmarkNml(landmarks: FakeLandmark[]): string {
  const things = landmarks.map(
    ({ pairId, position: [x, y, z] }, index) => `
    <thing id="${index + 1}" name="Landmark ${pairId}" color.r="1" color.g="0" color.b="0" color.a="1">
      <nodes><node id="${index + 1}" x="${x}" y="${y}" z="${z}" /></nodes>
      <edges />
    </thing>`,
  );
  return `<things>${things.join("")}</things>`;
}

/** A worker iframe that only keeps its landmarks, without a real annotation. The user places
 * and deletes landmarks with setLandmarks.
 */
export class FakeWorker {
  landmarks: FakeLandmark[] = [];
  readonly receivedPairInfos: unknown[] = [];

  handleMessage: IframeMessageHandler = async ({ data, source }) => {
    let returnValue: unknown = null;
    switch (data.type) {
      case "exportTreesAsNmlString":
        returnValue = getLandmarkNml(this.landmarks);
        break;
      case "importLandmarks": {
        const { trees } = await parseNml(data.args[0]);
        for (const tree of trees.values()) {
          for (const node of tree.nodes.values()) {
            const pairId = getLandmarkPairId(tree.name) ?? 0;
            this.landmarks.push({ pairId, position: node.untransformedPosition });
          }
        }
        break;
      }
      case "setLandmarkPairInfo":
        this.receivedPairInfos.push(data.args[0]);
        break;
      default:
        source.postMessage({ type: "err", messageId: data.messageId, message: "unknown" }, "*");
        return;
    }
    source.postMessage({ type: "ack", messageId: data.messageId, returnValue }, "*");
  };
}

// The landmarks in the tree group at the given path of the annotation in the store of this
// test, sorted by pair id. Empty if there is no such group.
export function readStoredLandmarks(groupPath: string[]): FakeLandmark[] {
  const { treeGroups, trees } = enforceSkeletonTracing(Store.getState().annotation);
  let group: TreeGroup | undefined;
  let siblings = treeGroups;
  for (const name of groupPath) {
    group = siblings.find((treeGroup) => treeGroup.name === name);
    if (group == null) {
      return [];
    }
    siblings = group.children;
  }
  return trees
    .values()
    .filter((tree) => tree.groupId === group?.groupId)
    .flatMap((tree) =>
      tree.nodes.values().map((node) => ({
        pairId: getLandmarkPairId(tree.name) ?? 0,
        position: node.untransformedPosition,
      })),
    )
    .toArray()
    .toSorted((a, b) => a.pairId - b.pairId);
}

// Exporting trees as NML needs the build info for the NML header. The other requests keep the
// mock implementation of setupWebknossosForTesting.
export function mockBuildInfoRequest({ mocks }: WebknossosTestContext) {
  const receiveJSON = vi.mocked(mocks.Request.receiveJSON);
  const otherRequests = receiveJSON.getMockImplementation();
  receiveJSON.mockImplementation((url, options) =>
    url === "/api/buildinfo"
      ? Promise.resolve(buildInfo)
      : (otherRequests?.(url, options) ?? Promise.resolve()),
  );
}
