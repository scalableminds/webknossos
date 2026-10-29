import { sampleHdf5AgglomerateName } from "test/fixtures/dataset_server_object";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import type { ServerSkeletonTracingTree } from "types/api_types";
import { TreeTypeEnum } from "viewer/constants";
import { getAgglomerateDiffOverlay } from "viewer/model/accessors/agglomerate_diff_accessor";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  addTreesAndGroupsAction,
  deleteTreeAction,
  loadAgglomerateTreeAtPositionAction,
  setAgglomerateDiffReferenceAction,
  setTreesAgglomerateInfoTracingIdAction,
} from "viewer/model/actions/skeletontracing_actions";
import { createMutableTreeMapFromTreeArray } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import { Store } from "viewer/singletons";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const getSkeleton = () => enforceSkeletonTracing(Store.getState().annotation);
const getOverlay = () => getAgglomerateDiffOverlay(Store.getState());
const getDiffs = () => Object.values(getOverlay().diffs);
const isDiffUrl = (url: URL) => url.pathname.includes("/diffToReference/");
const isRawDataUrl = (url: URL) => url.pathname.endsWith(`/layers/${layerName}/data`);

function addAgglomerateTrees(agglomerateIds: bigint[]) {
  Store.dispatch(
    addTreesAndGroupsAction(
      createMutableTreeMapFromTreeArray(
        agglomerateIds.map((id, idx) =>
          makeServerTree(idx + 1, 2 * idx + 1, {
            type: TreeTypeEnum.AGGLOMERATE,
            agglomerateInfo: { agglomerateId: id, mappingName },
          }),
        ),
      ),
      [],
    ),
  );
}

function getAgglomerateTreeId(id: bigint): number {
  return getSkeleton()
    .trees.values()
    .find((tree) => tree.agglomerateInfo?.agglomerateId === id)!.treeId;
}

// Answers the unmapped voxel reads with segmentIdAtFirstNode and the diff requests with one tree of
// added edges. If pendingDiffs is passed, the diff requests are only answered once the functions
// pushed to it are called. Returns a function that returns the requested urls.
function mockDiffRequests(
  { mocks }: WebknossosTestContext,
  pendingDiffs?: Array<() => void>,
): () => URL[] {
  const defaultReceiveArraybuffer = vi
    .mocked(mocks.Request.receiveArraybuffer)
    .getMockImplementation()!;
  vi.mocked(mocks.Request.receiveArraybuffer).mockImplementation((url: string, ...rest) => {
    if (url.includes("/diffToReference/")) {
      if (pendingDiffs == null) return Promise.resolve(new ArrayBuffer(0));
      return new Promise((resolve) => pendingDiffs.push(() => resolve(new ArrayBuffer(0))));
    }
    if (new URL(url, "http://localhost").searchParams.get("width") === "1") {
      // The segmentation layer of the fixture has the element class uint32
      return Promise.resolve(new Uint32Array([Number(segmentIdAtFirstNode)]).buffer);
    }
    return defaultReceiveArraybuffer(url, ...rest);
  });
  vi.mocked(mocks.parseProtoTracing).mockImplementation(
    () =>
      ({
        trees: [
          makeServerTree(1, 1, {
            name: "added edges",
            metadata: [{ key: "referenceAgglomerateId", stringValue: "9" }],
          }),
        ],
      }) as any,
  );
  return () =>
    (vi.mocked(mocks.Request.receiveArraybuffer).mock.calls as Array<[string]>).map(
      ([url]) => new URL(url, "http://localhost"),
    );
}

describe("Agglomerate diff saga", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton");
    Store.dispatch(setAgglomerateDiffReferenceAction(layerName, referenceMappingName));
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

  it<WebknossosTestContext>("removes the diff when the agglomerate skeleton is deleted", async (context) => {
    mockDiffRequests(context);
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    Store.dispatch(deleteTreeAction(getAgglomerateTreeId(agglomerateId)));

    await vi.waitFor(() => expect(getDiffs().length).toBe(0));
    expect(getOverlay().skeleton.trees.size()).toBe(0);
  });

  it<WebknossosTestContext>("removes the diff when the reference agglomerate view is disabled", async (context) => {
    mockDiffRequests(context);
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    Store.dispatch(setAgglomerateDiffReferenceAction(layerName, null));

    await vi.waitFor(() => expect(getDiffs().length).toBe(0));
    expect(getOverlay().skeleton.trees.size()).toBe(0);
  });

  it<WebknossosTestContext>("removes the diff when the agglomerate skeleton becomes part of an editable mapping", async (context) => {
    mockDiffRequests(context);
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));

    // Dispatched when proofreading starts
    Store.dispatch(setTreesAgglomerateInfoTracingIdAction("volumeTracingId"));

    await vi.waitFor(() => expect(getDiffs().length).toBe(0));
  });

  it<WebknossosTestContext>("compares the same segment's reference agglomerate when the reference agglomerate view changes", async (context) => {
    const getUrls = mockDiffRequests(context);
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));
    const rawDataReadCount = getUrls().filter(isRawDataUrl).length;

    Store.dispatch(setAgglomerateDiffReferenceAction(layerName, "agglomerate_view_2"));

    await vi.waitFor(() =>
      expect(getDiffs()[0]).toMatchObject({
        referenceMappingName: "agglomerate_view_2",
        status: "loaded",
      }),
    );
    expect(getDiffs().length).toBe(1);
    expect(getOverlay().skeleton.trees.size()).toBe(1);
    // The remembered segment id is used without reading the voxel again
    expect(getUrls().filter(isRawDataUrl).length).toBe(rawDataReadCount);
    const lastDiffUrl = getUrls().filter(isDiffUrl).at(-1);
    expect(lastDiffUrl?.searchParams.get("segmentId")).toBe(segmentIdAtFirstNode.toString());
  });

  it<WebknossosTestContext>("doesn't request a failed diff again", async (context) => {
    const getUrls = mockDiffRequests(context);
    vi.mocked(context.mocks.parseProtoTracing).mockImplementation(() => {
      throw new Error("Invalid response");
    });
    addAgglomerateTrees([agglomerateId]);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("failed"));

    // Another change of the agglomerate skeletons triggers a reconciliation
    addAgglomerateTrees([43n]);
    await vi.waitFor(() =>
      expect(getDiffs().map((diff) => diff.status)).toEqual(["failed", "failed"]),
    );
    expect(getUrls().filter(isDiffUrl).length).toBe(2);
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
    const { mocks } = context;
    const getUrls = mockDiffRequests(context);
    const skeletonBuffer = new ArrayBuffer(1);
    const skeletonRequest: { resolve?: (buffer: ArrayBuffer) => void } = {};
    const answerDiffRequest = vi.mocked(mocks.Request.receiveArraybuffer).getMockImplementation()!;
    vi.mocked(mocks.Request.receiveArraybuffer).mockImplementation((url: string, ...rest) => {
      if (url.includes(`/tree/${clickedAgglomerateId}`)) {
        return new Promise((resolve) => {
          skeletonRequest.resolve = resolve;
        });
      }
      if (new URL(url, "http://localhost").searchParams.get("width") === "1") {
        return Promise.resolve(new Uint32Array([Number(clickedSegmentId)]).buffer);
      }
      return answerDiffRequest(url, ...rest);
    });
    vi.mocked(mocks.parseProtoTracing).mockImplementation((buffer) =>
      buffer === skeletonBuffer
        ? ({
            trees: [
              makeServerTree(1, 1, {
                type: TreeTypeEnum.AGGLOMERATE,
                agglomerateInfo: { agglomerateId: clickedAgglomerateId, mappingName },
              }),
            ],
          } as any)
        : ({ trees: [makeServerTree(1, 1, { name: "added edges" })] } as any),
    );

    Store.dispatch(loadAgglomerateTreeAtPositionAction(layerName, mappingName, [5, 6, 7]));

    // The diff is requested while the agglomerate skeleton is still loading
    await vi.waitFor(() => expect(getUrls().some(isDiffUrl)).toBe(true));
    expect(skeletonRequest.resolve).toBeDefined();
    expect(getUrls().find(isDiffUrl)?.searchParams.get("segmentId")).toBe(
      clickedSegmentId.toString(),
    );
    expect(getUrls().find(isRawDataUrl)?.searchParams.get("x")).toBe("5");

    skeletonRequest.resolve!(skeletonBuffer);
    await vi.waitFor(() => expect(getDiffs()[0]?.status).toBe("loaded"));
    expect(getDiffs()[0].agglomerateId).toBe(clickedAgglomerateId);
    expect(Object.values(getOverlay().segmentIdByAgglomerate)).toEqual([clickedSegmentId]);
    // The diff was only requested once, although the agglomerate skeleton was added afterwards
    expect(getUrls().filter(isDiffUrl).length).toBe(1);
  });
});
