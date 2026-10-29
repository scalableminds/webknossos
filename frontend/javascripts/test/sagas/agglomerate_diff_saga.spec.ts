import { sleep } from "libs/utils";
import { sampleHdf5AgglomerateName } from "test/fixtures/dataset_server_object";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import type { ServerSkeletonTracingTree } from "types/api_types";
import { TreeTypeEnum } from "viewer/constants";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  addTreesAndGroupsAction,
  deleteTreeAction,
  loadAgglomerateTreeAtPositionAction,
  setAgglomerateDiffReferenceAction,
} from "viewer/model/actions/skeletontracing_actions";
import {
  getAgglomerateDiffInfo,
  getAgglomerateDiffMetadata,
} from "viewer/model/helpers/agglomerate_diff_helpers";
import { createMutableTreeMapFromTreeArray } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import { Store } from "viewer/singletons";
import { makeBasicGroupObject } from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { beforeEach, describe, expect, it, vi } from "vitest";

const layerName = "segmentation";
const mappingName = sampleHdf5AgglomerateName;
const referenceMappingName = "agglomerate_view_0";
const agglomerateId = 42n;
const clickedSegmentId = 1337n;
// vi.mock is hoisted above the module scope, so the constant has to be hoisted, too
const { clickedAgglomerateId } = vi.hoisted(() => ({ clickedAgglomerateId: 77n }));

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

function getSkeleton() {
  return enforceSkeletonTracing(Store.getState().annotation);
}

function getDiffTrees() {
  return getSkeleton()
    .trees.values()
    .filter((tree) => getAgglomerateDiffInfo(tree) != null)
    .toArray();
}

function addAgglomerateTree() {
  Store.dispatch(
    addTreesAndGroupsAction(
      createMutableTreeMapFromTreeArray([
        makeServerTree(1, 1, {
          type: TreeTypeEnum.AGGLOMERATE,
          agglomerateInfo: { agglomerateId, mappingName },
        }),
      ]),
      [],
    ),
  );
}

async function addAgglomerateTreeWithDiffTrees() {
  addAgglomerateTree();
  const metadata = getAgglomerateDiffMetadata({
    layerName,
    agglomerateId,
    mappingName,
    referenceMappingName,
    segmentId: clickedSegmentId,
    referenceAgglomerateId: 7n,
  });
  Store.dispatch(
    addTreesAndGroupsAction(
      createMutableTreeMapFromTreeArray([
        makeServerTree(2, 3, { groupId: 1, metadata }),
        makeServerTree(3, 5, { groupId: 1, metadata }),
      ]),
      [makeBasicGroupObject(1, "diff group")],
    ),
  );
  await sleep(50);
  expect(getDiffTrees().length).toBe(2);
  expect(getSkeleton().treeGroups.some((group) => group.name === "diff group")).toBe(true);
}

describe("Agglomerate diff saga", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton");
    Store.dispatch(setAgglomerateDiffReferenceAction(layerName, referenceMappingName));
    await sleep(50);
  });

  it("deletes the diff trees and their group when the agglomerate skeleton is deleted", async () => {
    await addAgglomerateTreeWithDiffTrees();
    const agglomerateTree = getSkeleton()
      .trees.values()
      .find((tree) => tree.type === TreeTypeEnum.AGGLOMERATE);

    Store.dispatch(deleteTreeAction(agglomerateTree!.treeId));
    await sleep(50);

    expect(getDiffTrees().length).toBe(0);
    expect(getSkeleton().treeGroups.some((group) => group.name === "diff group")).toBe(false);
  });

  it("deletes the diff trees when the reference agglomerate view is disabled", async () => {
    await addAgglomerateTreeWithDiffTrees();

    Store.dispatch(setAgglomerateDiffReferenceAction(layerName, null));
    await sleep(50);

    expect(getDiffTrees().length).toBe(0);
    expect(getSkeleton().treeGroups.some((group) => group.name === "diff group")).toBe(false);
    // The agglomerate skeleton itself is kept
    expect(
      getSkeleton()
        .trees.values()
        .some((tree) => tree.type === TreeTypeEnum.AGGLOMERATE),
    ).toBe(true);
  });

  it("keeps the diff trees when an unrelated tree is deleted", async () => {
    await addAgglomerateTreeWithDiffTrees();
    const unrelatedTree = getSkeleton()
      .trees.values()
      .find(
        (tree) => tree.type !== TreeTypeEnum.AGGLOMERATE && getAgglomerateDiffInfo(tree) == null,
      );

    Store.dispatch(deleteTreeAction(unrelatedTree!.treeId));
    await sleep(50);

    expect(getDiffTrees().length).toBe(2);
  });

  it<WebknossosTestContext>("compares the same segment's reference agglomerate when the reference agglomerate view changes", async ({
    mocks,
  }) => {
    await addAgglomerateTreeWithDiffTrees();
    const newReferenceMappingName = "agglomerate_view_2";
    vi.mocked(mocks.Request.receiveArraybuffer).mockResolvedValueOnce(new ArrayBuffer(0));
    vi.mocked(mocks.parseProtoTracing).mockReturnValueOnce({
      trees: [
        makeServerTree(1, 1, {
          name: "added edges",
          metadata: [{ key: "referenceAgglomerateId", stringValue: "9" }],
        }),
      ],
    } as any);

    Store.dispatch(setAgglomerateDiffReferenceAction(layerName, newReferenceMappingName));

    const getDiffUrl = () =>
      (vi.mocked(mocks.Request.receiveArraybuffer).mock.calls as Array<[string]>)
        .map(([url]) => url)
        .find((url) => url.includes("/diffToReference/"));
    await vi.waitFor(() => expect(getDiffUrl()).toBeDefined());
    await vi.waitFor(() => expect(getDiffTrees().length).toBe(1));
    const diffUrl = getDiffUrl();
    const params = new URL(diffUrl!, "http://localhost").searchParams;
    expect(params.get("segmentId")).toBe(clickedSegmentId.toString());
    expect(params.get("referenceMappingName")).toBe(newReferenceMappingName);

    const diffTrees = getDiffTrees();
    expect(getAgglomerateDiffInfo(diffTrees[0])).toMatchObject({
      referenceMappingName: newReferenceMappingName,
      segmentId: clickedSegmentId,
      referenceAgglomerateId: 9n,
    });
    expect(diffTrees[0].name).toContain(`agglomerate 9 of ${newReferenceMappingName}`);
  });

  it<WebknossosTestContext>("reads the unmapped segment id at the first node if no segment is known", async ({
    mocks,
  }) => {
    addAgglomerateTree();
    const segmentIdAtFirstNode = 4711;
    vi.mocked(mocks.Request.receiveArraybuffer)
      // The segmentation layer of the fixture has the element class uint32
      .mockResolvedValueOnce(new Uint32Array([segmentIdAtFirstNode]).buffer)
      .mockResolvedValueOnce(new ArrayBuffer(0));
    vi.mocked(mocks.parseProtoTracing).mockReturnValueOnce({
      trees: [makeServerTree(1, 1, { name: "added edges" })],
    } as any);

    Store.dispatch(setAgglomerateDiffReferenceAction(layerName, "agglomerate_view_2"));
    await vi.waitFor(() => expect(getDiffTrees().length).toBe(1));

    const urls = (vi.mocked(mocks.Request.receiveArraybuffer).mock.calls as Array<[string]>).map(
      ([url]) => new URL(url, "http://localhost"),
    );
    const rawDataUrl = urls.find((url) => url.pathname.endsWith(`/layers/${layerName}/data`));
    // The first node of the agglomerate skeleton is at (1, 0, 0)
    expect(rawDataUrl?.searchParams.get("x")).toBe("1");
    expect(rawDataUrl?.searchParams.get("width")).toBe("1");
    // The raw data must not be mapped
    expect(rawDataUrl?.searchParams.has("mappingName")).toBe(false);
    const diffUrl = urls.find((url) => url.pathname.includes("/diffToReference/"));
    expect(diffUrl?.searchParams.get("segmentId")).toBe(segmentIdAtFirstNode.toString());
    expect(getAgglomerateDiffInfo(getDiffTrees()[0])?.segmentId).toBe(BigInt(segmentIdAtFirstNode));
  });

  it<WebknossosTestContext>("requests the diff of the clicked segment in parallel to the agglomerate skeleton", async ({
    mocks,
  }) => {
    const skeletonBuffer = new ArrayBuffer(1);
    const diffBuffer = new ArrayBuffer(2);
    let resolveSkeletonRequest: ((buffer: ArrayBuffer) => void) | null = null;
    const defaultReceiveArraybuffer = vi
      .mocked(mocks.Request.receiveArraybuffer)
      .getMockImplementation()!;
    vi.mocked(mocks.Request.receiveArraybuffer).mockImplementation((url: string, ...rest) => {
      if (url.includes(`/tree/${clickedAgglomerateId}`)) {
        return new Promise((resolve) => {
          resolveSkeletonRequest = resolve;
        });
      }
      if (url.includes("/diffToReference/")) return Promise.resolve(diffBuffer);
      if (new URL(url, "http://localhost").searchParams.get("width") === "1") {
        // The unmapped voxel at the clicked position (the segmentation layer has the element class uint32)
        return Promise.resolve(new Uint32Array([Number(clickedSegmentId)]).buffer);
      }
      return defaultReceiveArraybuffer(url, ...rest);
    });
    vi.mocked(mocks.parseProtoTracing).mockImplementation(
      (buffer) =>
        ({
          trees:
            buffer === skeletonBuffer
              ? [
                  makeServerTree(1, 1, {
                    type: TreeTypeEnum.AGGLOMERATE,
                    agglomerateInfo: { agglomerateId: clickedAgglomerateId, mappingName },
                  }),
                ]
              : [makeServerTree(1, 1, { name: "added edges" })],
        }) as any,
    );
    const getUrls = () =>
      (vi.mocked(mocks.Request.receiveArraybuffer).mock.calls as Array<[string]>).map(
        ([url]) => new URL(url, "http://localhost"),
      );

    Store.dispatch(loadAgglomerateTreeAtPositionAction(layerName, mappingName, [5, 6, 7]));

    // The diff is requested while the agglomerate skeleton is still loading
    await vi.waitFor(() =>
      expect(getUrls().some((url) => url.pathname.includes("/diffToReference/"))).toBe(true),
    );
    expect(resolveSkeletonRequest).not.toBeNull();
    expect(getDiffTrees().length).toBe(0);
    const diffUrl = getUrls().find((url) => url.pathname.includes("/diffToReference/"));
    expect(diffUrl?.searchParams.get("segmentId")).toBe(clickedSegmentId.toString());
    const rawDataUrl = getUrls().find((url) => url.pathname.endsWith(`/layers/${layerName}/data`));
    expect(rawDataUrl?.searchParams.get("x")).toBe("5");

    // The diff trees are only added once the agglomerate skeleton is present
    resolveSkeletonRequest!(skeletonBuffer);
    await vi.waitFor(() => expect(getDiffTrees().length).toBe(1));
    expect(getAgglomerateDiffInfo(getDiffTrees()[0])).toMatchObject({
      agglomerateId: clickedAgglomerateId,
      segmentId: clickedSegmentId,
    });
  });

  it<WebknossosTestContext>("requests the diffs of several agglomerate skeletons in parallel when the reference agglomerate view changes", async ({
    mocks,
  }) => {
    const agglomerateIds = [1n, 2n, 3n];
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
    const pendingDiffRequests: Array<(buffer: ArrayBuffer) => void> = [];
    vi.mocked(mocks.Request.receiveArraybuffer).mockImplementation((url: string) =>
      url.includes("/diffToReference/")
        ? new Promise((resolve) => {
            pendingDiffRequests.push(resolve);
          })
        : Promise.resolve(new Uint32Array([Number(clickedSegmentId)]).buffer),
    );
    vi.mocked(mocks.parseProtoTracing).mockImplementation(
      () => ({ trees: [makeServerTree(1, 1, { name: "added edges" })] }) as any,
    );

    Store.dispatch(setAgglomerateDiffReferenceAction(layerName, "agglomerate_view_2"));

    // All diffs are requested before any of them is answered
    await vi.waitFor(() => expect(pendingDiffRequests.length).toBe(agglomerateIds.length));
    for (const resolve of pendingDiffRequests) {
      resolve(new ArrayBuffer(0));
    }
    await vi.waitFor(() => expect(getDiffTrees().length).toBe(agglomerateIds.length));
    expect(
      new Set(getDiffTrees().map((tree) => getAgglomerateDiffInfo(tree)?.agglomerateId)),
    ).toEqual(new Set(agglomerateIds));
  });
});
