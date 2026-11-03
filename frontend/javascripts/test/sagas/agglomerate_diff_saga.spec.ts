// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'AgglomerateGraph.proto' or its co... Remove this comment to see the full error message
import AgglomerateGraphProto from "AgglomerateGraph.proto";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import { sleep } from "libs/utils";
import { Root } from "protobufjs/light";
import { sampleHdf5AgglomerateName } from "test/fixtures/dataset_server_object";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import type { ServerSkeletonTracingTree } from "types/api_types";
import { TreeTypeEnum } from "viewer/constants";
import {
  getAgglomerateDiffOverlay,
  getAgglomerateTreeIdsWithVisibleDiffs,
} from "viewer/model/accessors/agglomerate_diff_accessor";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { setAgglomerateDiffsVisibilityAction } from "viewer/model/actions/agglomerate_diff_actions";
import { setLayerMappingsAction } from "viewer/model/actions/dataset_actions";
import {
  finishMappingInitializationAction,
  setMappingAction,
  setMappingEnabledAction,
  updateLayerSettingAction,
} from "viewer/model/actions/settings_actions";
import {
  addTreesAndGroupsAction,
  deleteTreeAction,
  loadAgglomerateTreeAtPositionAction,
  setTreeMetadataAction,
  setTreesAgglomerateInfoTracingIdAction,
  setTreeVisibilityAction,
} from "viewer/model/actions/skeletontracing_actions";
import { createMutableTreeMapFromTreeArray } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import { Store } from "viewer/singletons";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const layerName = "segmentation";
const mappingName = sampleHdf5AgglomerateName;
const referenceMappingName = "agglomerate_view_0";
const agglomerateId = 42n;
const segmentIdAtFirstNode = 4711n;
// vi.mock is hoisted above the module scope, so the constant has to be hoisted, too
const { clickedAgglomerateId } = vi.hoisted(() => ({ clickedAgglomerateId: 77n }));
const clickedSegmentId = 1337n;

// The bucket data of the segmentation layer is not available in the tests, so the (mapped) id at the
// clicked position is mocked.
vi.mock("viewer/controller/combinations/volume_handlers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viewer/controller/combinations/volume_handlers")>()),
  getSegmentIdForPositionAsync: async () => clickedAgglomerateId,
}));

function makeServerTree(
  treeId: number,
  firstNodeId: number,
  overrides: Partial<ServerSkeletonTracingTree>,
): ServerSkeletonTracingTree {
  const node = (id: number) => ({
    id,
    position: { x: id, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    radius: 1,
    viewport: 0,
    mag: 1,
    bitDepth: 8,
    interpolation: false,
    createdTimestamp: 0,
    additionalCoordinates: [],
  });
  return {
    treeId,
    name: `tree ${treeId}`,
    nodes: [node(firstNodeId), node(firstNodeId + 1)],
    edges: [{ source: firstNodeId, target: firstNodeId + 1 }],
    branchPoints: [],
    comments: [],
    createdTimestamp: 0,
    color: { r: 1, g: 0, b: 0, a: 1 },
    isVisible: true,
    metadata: [],
    ...overrides,
  } as ServerSkeletonTracingTree;
}

// Encodes a diff like the datastore does (see AgglomerateGraphDiff.scala)
function encodeDiff(diff: {
  referenceAgglomerateId: number;
  positions: number[];
  addedEdges: number[];
  removedEdges: number[];
}): ArrayBuffer {
  const messageType = Root.fromJSON(AgglomerateGraphProto).lookupType(
    "com.scalableminds.webknossos.datastore.AgglomerateGraphDiffProto",
  );
  const bytes = messageType.encode(messageType.create(diff)).finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// One added edge between (1, 0, 0) and (2, 0, 0)
const diffWithOneAddedEdge = () =>
  encodeDiff({
    referenceAgglomerateId: 9,
    positions: [1, 0, 0, 2, 0, 0],
    addedEdges: [0, 1],
    removedEdges: [],
  });

const setReferenceMappingName = (referenceMappingName: string | null) =>
  Store.dispatch(
    updateLayerSettingAction(layerName, "agglomerateDiffReference", referenceMappingName),
  );

function setAgglomerateMappingEnabled(isEnabled: boolean) {
  if (isEnabled) {
    Store.dispatch(setMappingAction(layerName, mappingName, "AGGLOMERATE", false));
    Store.dispatch(finishMappingInitializationAction(layerName));
  } else {
    Store.dispatch(setMappingEnabledAction(layerName, false));
  }
}

const getSkeleton = () => enforceSkeletonTracing(Store.getState().annotation);
const getOverlay = () => getAgglomerateDiffOverlay(Store.getState());
const getDiffs = () => Object.values(getOverlay().diffs);
const isDiffUrl = (url: URL) => url.pathname.includes("/diffToReference/");
const isRawDataUrl = (url: URL) => url.pathname.endsWith(`/layers/${layerName}/data`);

function addAgglomerateTrees(
  agglomerateIds: bigint[],
  metadata: ServerSkeletonTracingTree["metadata"] = [],
) {
  Store.dispatch(
    addTreesAndGroupsAction(
      createMutableTreeMapFromTreeArray(
        agglomerateIds.map((id, idx) =>
          makeServerTree(idx + 1, 2 * idx + 1, {
            type: TreeTypeEnum.AGGLOMERATE,
            agglomerateInfo: { agglomerateId: id, mappingName },
            metadata,
          }),
        ),
      ),
      [],
    ),
  );
}

function getAgglomerateTree(id: bigint) {
  return getSkeleton()
    .trees.values()
    .find((tree) => tree.agglomerateInfo?.agglomerateId === id)!;
}

const getRawDataPosition = (url: URL | undefined) =>
  ["x", "y", "z"].map((dim) => url?.searchParams.get(dim));

// Answers the unmapped voxel reads with segmentIdAtFirstNode and the diff requests with the given
// diff (one added edge by default). If pendingDiffs is passed, the diff requests are only answered
// once the functions pushed to it are called. Returns a function that returns the requested urls.
function mockDiffRequests(
  { mocks }: WebknossosTestContext,
  pendingDiffs?: Array<() => void>,
  getDiffResponse: () => Promise<ArrayBuffer> = () => Promise.resolve(diffWithOneAddedEdge()),
): () => URL[] {
  const defaultReceiveArraybuffer = vi
    .mocked(mocks.Request.receiveArraybuffer)
    .getMockImplementation()!;
  vi.mocked(mocks.Request.receiveArraybuffer).mockImplementation((url: string, ...rest) => {
    if (url.includes("/diffToReference/")) {
      if (pendingDiffs == null) return getDiffResponse();
      return new Promise((resolve) => pendingDiffs.push(() => resolve(getDiffResponse())));
    }
    if (new URL(url, "http://localhost").searchParams.get("width") === "1") {
      // The segmentation layer of the fixture has the element class uint32
      return Promise.resolve(new Uint32Array([Number(segmentIdAtFirstNode)]).buffer);
    }
    return defaultReceiveArraybuffer(url, ...rest);
  });
  return () =>
    (vi.mocked(mocks.Request.receiveArraybuffer).mock.calls as Array<[string]>).map(
      ([url]) => new URL(url, "http://localhost"),
    );
}

// Answers the unmapped voxel reads with clickedSegmentId and parses the agglomerate skeleton request
// of clickedAgglomerateId (which is only answered once the returned resolve function is called) as
// a single agglomerate tree. Other requests are answered by the previous mock (see mockDiffRequests).
function mockClickedAgglomerateSkeletonRequest({ mocks }: WebknossosTestContext): {
  resolve?: (buffer: ArrayBuffer) => void;
} {
  const skeletonRequest: { resolve?: (buffer: ArrayBuffer) => void } = {};
  const answerOtherRequest = vi.mocked(mocks.Request.receiveArraybuffer).getMockImplementation()!;
  vi.mocked(mocks.Request.receiveArraybuffer).mockImplementation((url: string, ...rest) => {
    if (url.includes(`/tree/${clickedAgglomerateId}`)) {
      return new Promise((resolve) => {
        skeletonRequest.resolve = resolve;
      });
    }
    if (new URL(url, "http://localhost").searchParams.get("width") === "1") {
      return Promise.resolve(new Uint32Array([Number(clickedSegmentId)]).buffer);
    }
    return answerOtherRequest(url, ...rest);
  });
  vi.mocked(mocks.parseProtoTracing).mockImplementation(
    () =>
      ({
        trees: [
          makeServerTree(1, 1, {
            type: TreeTypeEnum.AGGLOMERATE,
            agglomerateInfo: { agglomerateId: clickedAgglomerateId, mappingName },
          }),
        ],
      }) as any,
  );
  return skeletonRequest;
}

const getDiffToasts = (toastSpy: MockInstance<typeof Toast.error>) =>
  toastSpy.mock.calls.filter(([_message, config]) =>
    config?.key?.startsWith("agglomerate-diff-error-"),
  );

describe("Agglomerate diff saga", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton");
    // The reference views have to be agglomerate files of the layer
    Store.dispatch(
      setLayerMappingsAction(
        layerName,
        [],
        [mappingName, referenceMappingName, "agglomerate_view_2"],
      ),
    );
    // Diffs are only computed while an agglomerate mapping is active
    setAgglomerateMappingEnabled(true);
    setReferenceMappingName(referenceMappingName);
  });

  it<WebknossosTestContext>("shows the diff of an agglomerate skeleton without adding trees to the annotation", async (context) => {
    const getUrls = mockDiffRequests(context);
    const treeCountBefore = getSkeleton().trees.size();

    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    // The segment at the first node of the agglomerate skeleton (1, 0, 0) is compared
    const rawDataUrl = getUrls().find(isRawDataUrl);
    expect(rawDataUrl?.searchParams.get("x")).toBe("1");
    // The raw data must not be mapped
    expect(rawDataUrl?.searchParams.has("mappingName")).toBe(false);
    const diffUrl = getUrls().find(isDiffUrl);
    expect(diffUrl?.searchParams.get("segmentId")).toBe(segmentIdAtFirstNode.toString());
    expect(diffUrl?.searchParams.get("referenceMappingName")).toBe(referenceMappingName);

    expect(getDiffs()[0]).toMatchObject({
      agglomerateId,
      referenceAgglomerateId: 9n,
      addedEdgeCount: 1,
      removedEdgeCount: 0,
    });
    expect(getOverlay().skeleton.trees.size()).toBe(1);
    // Only the agglomerate skeleton was added to the annotation
    expect(getSkeleton().trees.size()).toBe(treeCountBefore + 1);
  });

  it<WebknossosTestContext>("shows the added and removed edges of a diff as one tree each", async (context) => {
    // Segment 0 is an endpoint of both an added and a removed edge. The added edges are not connected.
    mockDiffRequests(context, undefined, () =>
      Promise.resolve(
        encodeDiff({
          referenceAgglomerateId: 9,
          positions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          addedEdges: [0, 1, 2, 3],
          removedEdges: [0, 4],
        }),
      ),
    );

    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    expect(getDiffs()[0]).toMatchObject({ addedEdgeCount: 2, removedEdgeCount: 1 });
    const trees = getOverlay().skeleton.trees.values().toArray();
    expect(trees.map((tree) => [tree.name, tree.nodes.size(), tree.edges.size()])).toEqual([
      ["Added edges", 4, 2],
      ["Removed edges", 2, 1],
    ]);
    const nodeIds = trees.flatMap((tree) => tree.nodes.keys().toArray());
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    const [addedTree, removedTree] = trees;
    expect(
      addedTree.edges
        .all()
        .map((edge) => [
          addedTree.nodes.getOrThrow(edge.source).untransformedPosition,
          addedTree.nodes.getOrThrow(edge.target).untransformedPosition,
        ])
        .toArray(),
    ).toEqual([
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      [
        [7, 8, 9],
        [10, 11, 12],
      ],
    ]);
    expect(
      removedTree.nodes
        .values()
        .map((node) => node.untransformedPosition)
        .toArray(),
    ).toEqual([
      [1, 2, 3],
      [13, 14, 15],
    ]);
  });

  it<WebknossosTestContext>("removes the diff when the agglomerate skeleton is deleted", async (context) => {
    mockDiffRequests(context);
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    Store.dispatch(deleteTreeAction(getAgglomerateTree(agglomerateId).treeId));

    await vi.waitFor(() => expect(getDiffs().length).toBe(0));
    expect(getOverlay().skeleton.trees.size()).toBe(0);
  });

  it<WebknossosTestContext>("removes the diff when the reference agglomerate view is disabled", async (context) => {
    mockDiffRequests(context);
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    setReferenceMappingName(null);

    await vi.waitFor(() => expect(getDiffs().length).toBe(0));
    expect(getOverlay().skeleton.trees.size()).toBe(0);
  });

  it<WebknossosTestContext>("doesn't compare to a reference agglomerate view that the layer doesn't have", async (context) => {
    const getUrls = mockDiffRequests(context);
    // E.g., an agglomerate file that was removed from the dataset after it was selected
    setReferenceMappingName("removed_agglomerate_view");
    addAgglomerateTrees([agglomerateId]);

    await sleep(50);
    expect(getDiffs().length).toBe(0);
    expect(getUrls().some(isDiffUrl)).toBe(false);
  });

  it<WebknossosTestContext>("removes the diffs while no agglomerate mapping is active", async (context) => {
    const getUrls = mockDiffRequests(context);
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    setAgglomerateMappingEnabled(false);
    await vi.waitFor(() => expect(getDiffs().length).toBe(0));
    expect(getOverlay().skeleton.trees.size()).toBe(0);

    setAgglomerateMappingEnabled(true);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));
    expect(getUrls().filter(isDiffUrl).length).toBe(2);
  });

  it<WebknossosTestContext>("removes the diff when the agglomerate skeleton becomes part of an editable mapping", async (context) => {
    mockDiffRequests(context);
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    // Dispatched when proofreading starts
    Store.dispatch(setTreesAgglomerateInfoTracingIdAction("volumeTracingId"));

    await vi.waitFor(() => expect(getDiffs().length).toBe(0));
  });

  it<WebknossosTestContext>("compares the segment at the stored clicked position of an agglomerate skeleton", async (context) => {
    // E.g., an agglomerate skeleton that was loaded by clicking before the annotation was reloaded
    const getUrls = mockDiffRequests(context);
    addAgglomerateTrees(
      [agglomerateId],
      [{ key: "clickedPosition", stringListValue: ["8", "9", "10"] }],
    );
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    expect(getRawDataPosition(getUrls().find(isRawDataUrl))).toEqual(["8", "9", "10"]);
  });

  it<WebknossosTestContext>("only compares an agglomerate skeleton for the layer it was loaded for", async (context) => {
    const getUrls = mockDiffRequests(context);
    // Another layer could have an agglomerate file with the same name
    addAgglomerateTrees([agglomerateId], [{ key: "layerName", stringValue: "otherLayer" }]);
    addAgglomerateTrees([43n], [{ key: "layerName", stringValue: layerName }]);

    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));
    await sleep(50);
    expect(getDiffs().map((diff) => diff.agglomerateId)).toEqual([43n]);
    expect(getDiffs()[0].sourceTreeId).toBe(getAgglomerateTree(43n).treeId);
    expect(getUrls().filter(isDiffUrl).length).toBe(1);
  });

  it.for([
    ["8", "9"],
    ["8", "", "10"],
    ["8", "nine", "10"],
  ])(
    "compares the first node if the stored clicked position is invalid: %j",
    async (clickedPosition, context) => {
      const getUrls = mockDiffRequests(context as WebknossosTestContext);
      addAgglomerateTrees(
        [agglomerateId],
        [{ key: "clickedPosition", stringListValue: clickedPosition }],
      );
      await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

      expect(getRawDataPosition(getUrls().find(isRawDataUrl))).toEqual(["1", "0", "0"]);
    },
  );

  it<WebknossosTestContext>("compares at the same position when the reference agglomerate view changes", async (context) => {
    const getUrls = mockDiffRequests(context);
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    setReferenceMappingName("agglomerate_view_2");

    await vi.waitFor(() =>
      expect(getDiffs()[0]).toMatchObject({
        referenceMappingName: "agglomerate_view_2",
        status: "loaded",
      }),
    );
    expect(getDiffs().length).toBe(1);
    expect(getOverlay().skeleton.trees.size()).toBe(1);
    expect(getRawDataPosition(getUrls().filter(isRawDataUrl).at(-1))).toEqual(["1", "0", "0"]);
    const lastDiffUrl = getUrls().filter(isDiffUrl).at(-1);
    expect(lastDiffUrl?.searchParams.get("segmentId")).toBe(segmentIdAtFirstNode.toString());
  });

  it<WebknossosTestContext>("doesn't request a failed diff again", async (context) => {
    const getUrls = mockDiffRequests(context, undefined, () =>
      Promise.reject(new Error("Invalid response")),
    );
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("failed"));

    // Another change of the agglomerate skeletons triggers a reconciliation
    addAgglomerateTrees([43n]);
    await vi.waitFor(() =>
      expect(getDiffs().map((diff) => diff.status)).toEqual(["failed", "failed"]),
    );
    expect(getUrls().filter(isDiffUrl).length).toBe(2);
  });

  it<WebknossosTestContext>("shows a single toast for failed diffs of a layer and lists the reasons", async (context) => {
    const toastSpy = vi.spyOn(Toast, "error");
    const notifySpy = vi.spyOn(ErrorHandling, "notify");
    // Failed requests are rejected like this by Request (see handleError)
    mockDiffRequests(context, undefined, () =>
      Promise.reject({
        messages: [
          { error: "Could not compute the diff." },
          { chain: "[Server Time 2026-11-03T10:00:00Z] Agglomerate has too many edges" },
        ],
        status: 400,
      }),
    );

    addAgglomerateTrees([1n, 2n]);
    await vi.waitFor(() =>
      expect(getDiffs().map((diff) => diff.status)).toEqual(["failed", "failed"]),
    );

    expect(getDiffs()[0].errorMessage).toBe(
      "Could not compute the diff. Agglomerate has too many edges",
    );
    // Toasts with the same key replace each other
    const diffToasts = getDiffToasts(toastSpy);
    expect(diffToasts.length).toBe(2);
    expect(new Set(diffToasts.map(([_message, config]) => config?.key)).size).toBe(1);
    expect(diffToasts.at(-1)?.[0]).toContain("Could not compare 2 agglomerate skeletons");
    // Expected errors (4xx) are not reported
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it<WebknossosTestContext>("removes loading diffs as soon as they are obsolete", async (context) => {
    const pendingDiffs: Array<() => void> = [];
    const getUrls = mockDiffRequests(context, pendingDiffs);
    addAgglomerateTrees([1n, 2n, 3n, 4n, 5n]);
    await vi.waitFor(() => expect(pendingDiffs.length).toBe(4));

    setReferenceMappingName(null);

    expect(getDiffs().length).toBe(0);
    for (const resolve of pendingDiffs) {
      resolve();
    }
    await vi.waitFor(() => expect(getUrls().filter(isDiffUrl).length).toBe(4));
    // The queued request of the fifth diff is skipped and the answered diffs are ignored
    await sleep(50);
    expect(getUrls().filter(isDiffUrl).length).toBe(4);
    expect(getDiffs().length).toBe(0);
    expect(getOverlay().skeleton.trees.size()).toBe(0);
  });

  it<WebknossosTestContext>("only shows the diff of a visible agglomerate skeleton and dims the latter", async (context) => {
    mockDiffRequests(context);
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));
    const treeId = getAgglomerateTree(agglomerateId).treeId;
    const isDiffTreeVisible = () => getOverlay().skeleton.trees.values().toArray()[0].isVisible;
    const getDimmedTreeIds = () => [...getAgglomerateTreeIdsWithVisibleDiffs(Store.getState())];
    expect(isDiffTreeVisible()).toBe(true);
    expect(getDimmedTreeIds()).toEqual([treeId]);

    Store.dispatch(setTreeVisibilityAction(treeId, false));
    await vi.waitFor(() => expect(isDiffTreeVisible()).toBe(false));
    expect(getDimmedTreeIds()).toEqual([]);

    // Showing all diffs again doesn't show the diff of the hidden agglomerate skeleton
    Store.dispatch(setAgglomerateDiffsVisibilityAction(false));
    Store.dispatch(setAgglomerateDiffsVisibilityAction(true));
    expect(isDiffTreeVisible()).toBe(false);

    Store.dispatch(setTreeVisibilityAction(treeId, true));
    await vi.waitFor(() => expect(isDiffTreeVisible()).toBe(true));
    expect(getDimmedTreeIds()).toEqual([treeId]);

    Store.dispatch(setAgglomerateDiffsVisibilityAction(false));
    expect(isDiffTreeVisible()).toBe(false);
    expect(getDimmedTreeIds()).toEqual([]);
  });

  it<WebknossosTestContext>("requests the diffs of several agglomerate skeletons in parallel", async (context) => {
    const pendingDiffs: Array<() => void> = [];
    mockDiffRequests(context, pendingDiffs);
    const agglomerateIds = [1n, 2n, 3n];

    addAgglomerateTrees(agglomerateIds);

    // All diffs are requested before any of them is answered
    await vi.waitFor(() => expect(pendingDiffs.length).toBe(agglomerateIds.length));
    for (const resolve of pendingDiffs) {
      resolve();
    }
    await vi.waitFor(() =>
      expect(getDiffs().map((diff) => diff.status)).toEqual(["loaded", "loaded", "loaded"]),
    );
    expect(new Set(getDiffs().map((diff) => diff.agglomerateId))).toEqual(new Set(agglomerateIds));
    expect(getOverlay().skeleton.trees.size()).toBe(agglomerateIds.length);
  });

  it<WebknossosTestContext>("requests the diff of the clicked segment in parallel to the agglomerate skeleton", async (context) => {
    const getUrls = mockDiffRequests(context);
    const skeletonRequest = mockClickedAgglomerateSkeletonRequest(context);

    Store.dispatch(loadAgglomerateTreeAtPositionAction(layerName, mappingName, [5, 6, 7]));

    // The diff is requested while the agglomerate skeleton is still loading
    await vi.waitFor(() => expect(getUrls().some(isDiffUrl)).toBe(true));
    expect(skeletonRequest.resolve).toBeDefined();
    expect(getUrls().find(isDiffUrl)?.searchParams.get("segmentId")).toBe(
      clickedSegmentId.toString(),
    );
    expect(getRawDataPosition(getUrls().find(isRawDataUrl))).toEqual(["5", "6", "7"]);

    // The diff is kept although its agglomerate skeleton is still loading
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));
    expect(getDiffs()[0].awaitsAgglomerateSkeleton).toBe(true);

    // The diff is only shown once its agglomerate skeleton exists
    const areDiffTreesVisible = () =>
      getOverlay()
        .skeleton.trees.values()
        .toArray()
        .map((tree) => tree.isVisible);
    expect(areDiffTreesVisible()).toEqual([false]);

    skeletonRequest.resolve!(new ArrayBuffer(1));
    await vi.waitFor(() => expect(getDiffs()[0]?.awaitsAgglomerateSkeleton).toBe(false));
    expect(areDiffTreesVisible()).toEqual([true]);
    expect(getDiffs()[0].agglomerateId).toBe(clickedAgglomerateId);
    // The clicked position is stored with the agglomerate skeleton, so that it is compared at the
    // same position after a reload
    expect(getAgglomerateTree(clickedAgglomerateId).metadata).toEqual([
      { key: "layerName", stringValue: layerName },
      { key: "clickedPosition", stringListValue: ["5", "6", "7"] },
    ]);
    // The diff was only requested once, although the agglomerate skeleton was added afterwards
    expect(getUrls().filter(isDiffUrl).length).toBe(1);
  });

  it<WebknossosTestContext>("doesn't block the user interface while the diff of the clicked segment is loading", async (context) => {
    const pendingDiffs: Array<() => void> = [];
    mockDiffRequests(context, pendingDiffs);
    const skeletonRequest = mockClickedAgglomerateSkeletonRequest(context);
    const isLoadingAgglomerateTree = () =>
      Store.getState().operationContext.activeOperations.some(
        (operation) => operation.id === "LOAD_AGGLOMERATE_TREE",
      );

    Store.dispatch(loadAgglomerateTreeAtPositionAction(layerName, mappingName, [5, 6, 7]));
    await vi.waitFor(() => expect(skeletonRequest.resolve).toBeDefined());
    expect(isLoadingAgglomerateTree()).toBe(true);
    skeletonRequest.resolve!(new ArrayBuffer(1));

    await vi.waitFor(() => expect(getDiffs()[0]?.awaitsAgglomerateSkeleton).toBe(false));
    await vi.waitFor(() => expect(isLoadingAgglomerateTree()).toBe(false));
    expect(getDiffs()[0].status).toBe("loading");
    for (const resolve of pendingDiffs) {
      resolve();
    }
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));
  });

  it<WebknossosTestContext>("removes the diff of the clicked segment if the reference view changes while the agglomerate skeleton loads", async (context) => {
    mockDiffRequests(context);
    const skeletonRequest = mockClickedAgglomerateSkeletonRequest(context);

    Store.dispatch(loadAgglomerateTreeAtPositionAction(layerName, mappingName, [5, 6, 7]));
    await vi.waitFor(() => expect(skeletonRequest.resolve).toBeDefined());
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));
    setReferenceMappingName("agglomerate_view_2");
    // The diff is kept while its agglomerate skeleton is loading
    expect(getDiffs()[0]?.referenceMappingName).toBe(referenceMappingName);

    skeletonRequest.resolve!(new ArrayBuffer(1));

    // Only the diff to the new reference view remains
    await vi.waitFor(() =>
      expect(getDiffs().map((diff) => [diff.referenceMappingName, diff.status])).toEqual([
        ["agglomerate_view_2", "loaded"],
      ]),
    );
    expect(getOverlay().skeleton.trees.size()).toBe(1);
  });

  it<WebknossosTestContext>("doesn't request the diff of the clicked segment for a reference view that the layer doesn't have", async (context) => {
    const getUrls = mockDiffRequests(context);
    const skeletonRequest = mockClickedAgglomerateSkeletonRequest(context);
    setReferenceMappingName("removed_agglomerate_view");

    Store.dispatch(loadAgglomerateTreeAtPositionAction(layerName, mappingName, [5, 6, 7]));
    await vi.waitFor(() => expect(skeletonRequest.resolve).toBeDefined());
    skeletonRequest.resolve!(new ArrayBuffer(1));
    await vi.waitFor(() => expect(getAgglomerateTree(clickedAgglomerateId)).toBeDefined());

    await sleep(50);
    expect(getDiffs().length).toBe(0);
    expect(getUrls().some(isDiffUrl)).toBe(false);
  });

  it<WebknossosTestContext>("completes a diff without added or removed edges", async (context) => {
    mockDiffRequests(context, undefined, () =>
      Promise.resolve(
        encodeDiff({ referenceAgglomerateId: 9, positions: [], addedEdges: [], removedEdges: [] }),
      ),
    );
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    expect(getDiffs()[0]).toMatchObject({
      referenceAgglomerateId: 9n,
      addedEdgeCount: 0,
      removedEdgeCount: 0,
      treeIds: [],
    });
    expect(getOverlay().skeleton.trees.size()).toBe(0);
    // Only agglomerate skeletons whose diffs show edges are dimmed
    expect(getAgglomerateTreeIdsWithVisibleDiffs(Store.getState()).size).toBe(0);
  });

  it<WebknossosTestContext>("requests the diff again when the stored clicked position changes", async (context) => {
    const getUrls = mockDiffRequests(context);
    addAgglomerateTrees(
      [agglomerateId],
      [{ key: "clickedPosition", stringListValue: ["8", "9", "10"] }],
    );
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    Store.dispatch(
      setTreeMetadataAction(
        [{ key: "clickedPosition", stringListValue: ["11", "12", "13"] }],
        getAgglomerateTree(agglomerateId).treeId,
      ),
    );

    await vi.waitFor(() => expect(getUrls().filter(isDiffUrl).length).toBe(2));
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));
    expect(getDiffs()[0].positionInLayer).toEqual([11, 12, 13]);
    expect(getRawDataPosition(getUrls().filter(isRawDataUrl).at(-1))).toEqual(["11", "12", "13"]);
    expect(getOverlay().skeleton.trees.size()).toBe(1);
  });

  it<WebknossosTestContext>("ignores the response of a diff that was requested again for another position", async (context) => {
    const pendingDiffs: Array<() => void> = [];
    mockDiffRequests(context, pendingDiffs);
    addAgglomerateTrees(
      [agglomerateId],
      [{ key: "clickedPosition", stringListValue: ["8", "9", "10"] }],
    );
    await vi.waitFor(() => expect(pendingDiffs.length).toBe(1));

    // E.g., the agglomerate skeleton is deleted and loaded again by clicking on another segment
    Store.dispatch(deleteTreeAction(getAgglomerateTree(agglomerateId).treeId));
    await vi.waitFor(() => expect(getDiffs().length).toBe(0));
    addAgglomerateTrees(
      [agglomerateId],
      [{ key: "clickedPosition", stringListValue: ["11", "12", "13"] }],
    );
    await vi.waitFor(() => expect(pendingDiffs.length).toBe(2));

    pendingDiffs[0]();
    await sleep(50);
    expect(getDiffs()[0]).toMatchObject({ status: "loading", positionInLayer: [11, 12, 13] });
    expect(getOverlay().skeleton.trees.size()).toBe(0);

    pendingDiffs[1]();
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));
  });

  it<WebknossosTestContext>("doesn't show a toast if a diff fails after it became obsolete", async (context) => {
    const toastSpy = vi.spyOn(Toast, "error");
    const pendingDiffs: Array<() => void> = [];
    mockDiffRequests(context, pendingDiffs, () => Promise.reject(new Error("Invalid response")));
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(pendingDiffs.length).toBe(1));

    setReferenceMappingName(null);
    pendingDiffs[0]();

    await sleep(50);
    expect(getDiffs().length).toBe(0);
    expect(getDiffToasts(toastSpy).length).toBe(0);
  });
});
