import type {
  ServerNode,
  ServerSkeletonTracing,
  ServerSkeletonTracingTree,
  ServerTracing,
} from "types/api_types";

import { Root } from "protobufjs";
import { TreeTypeEnum, type TreeType } from "viewer/constants";
import { PROTO_FILES, PROTO_TYPES } from "viewer/model/helpers/proto_helpers";
import type { Edge, TreeMap } from "viewer/model/types/tree_types";
import type { WebknossosTestContext } from "test/helpers/apiHelpers";
import { loadAgglomerateSkeletonAtPosition } from "viewer/controller/combinations/segmentation_handlers";
import { vi } from "vitest";
import { type Saga, take, call, select } from "viewer/model/sagas/effect-generators";
import { getTreesWithType } from "viewer/model/accessors/skeletontracing_accessor";

export function encodeServerTracing(
  tracing: ServerTracing,
  annotationType: "skeleton" | "volume",
): ArrayBuffer {
  const protoRoot = Root.fromJSON(PROTO_FILES[annotationType]);
  const messageType = protoRoot.lookupType(PROTO_TYPES[annotationType]);

  // Verify that the object really matches the proto schema
  const err = messageType.verify(tracing);
  if (err) throw new Error(`Invalid ServerTracing: ${err}`);

  // Create an internal protobufjs message and encode
  const message = messageType.create(tracing);
  const u8 = new Uint8Array(messageType.encode(message).finish()); // Uint8Array

  // Vitest/fetch mocks often like ArrayBuffer
  return u8.buffer;
}

/**
 * Create an agglomerate skeleton as a ServerSkeletonTracing for the agglomerate given by the adjacencyList.
 *
 * @param adjacencyList array of tuples of edges between the segments
 * @param startNode the node id we want the skeleton for
 * @param tracingId id for the resulting tracing
 */
export function createSkeletonTracingFromAdjacency(
  adjacencyList: Array<[number, number]>,
  startNode: number,
  tracingId: string,
  version: number,
): ServerSkeletonTracing {
  // Build adjacency map (undirected)
  const adj = new Map<number, Set<number>>();
  for (const [a, b] of adjacencyList) {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }

  // BFS to find component containing startNode
  const visited = new Set<number>();
  const queue: number[] = [startNode];
  // If the startNode is truly isolated (not present in adjacency list), we still want a single-node component.
  visited.add(startNode);

  while (queue.length) {
    const n = queue.shift()!;
    const neighbours = adj.get(n);
    if (!neighbours) continue;
    for (const nb of neighbours) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }

  // If visited only contains startNode but startNode is present in adjacency pairs,
  // ensure we actually captured its component (we started with startNode so BFS above will expand).
  // Now collect edges whose both endpoints are inside the component
  const componentNodes = Array.from(visited).sort((a, b) => a - b);
  const componentNodeSet = new Set(componentNodes);

  const componentEdges: Edge[] = adjacencyList
    .filter(([a, b]) => componentNodeSet.has(a) && componentNodeSet.has(b) && a !== b)
    .map(([a, b]) => ({ source: a, target: b }));

  // Build ServerNode objects. Position = (n,n,n) as requested.
  const now = Date.now();
  const nodes: ServerNode[] = componentNodes.map((n) => ({
    id: n,
    position: { x: n, y: n, z: n },
    additionalCoordinates: [],
    rotation: { x: 0, y: 0, z: 0 },
    bitDepth: 8,
    viewport: 0,
    mag: 1,
    radius: 1,
    createdTimestamp: now,
    interpolation: false,
  }));

  // Single tree for this component
  const tree: ServerSkeletonTracingTree = {
    branchPoints: [],
    color: null,
    comments: [],
    edges: componentEdges,
    name: `component-${startNode}`,
    nodes,
    treeId: 1,
    createdTimestamp: now,
    groupId: null,
    isVisible: true,
    type: 1 as any as TreeType, // Needed as encoding only accepts enum ids and not the representative string.
    edgesAreVisible: true,
    metadata: [],
  };

  type ServerSkeletonTracingProtoCompatible = ServerSkeletonTracing & {
    datasetName: string; // Still part of the proto but unused. Needed to make
    // custom proto parsing & mocking work in proofreading skeleton tests.
  };

  const tracing: ServerSkeletonTracingProtoCompatible = {
    datasetName: "is-ignored-anyway",
    id: tracingId,
    userBoundingBoxes: [],
    userBoundingBox: undefined,
    createdTimestamp: now,
    error: undefined,
    additionalAxes: [],
    // version purposely left out; parseProtoTracing will delete it if present in the real server response
    editPosition: { x: startNode, y: startNode, z: startNode },
    editPositionAdditionalCoordinates: [],
    editRotation: { x: 0, y: 0, z: 0 },
    zoomLevel: 1,
    typ: "Skeleton",
    activeNodeId: startNode,
    boundingBox: undefined,
    trees: [tree],
    treeGroups: [],
    storedWithExternalTreeBodies: false,
    userStates: [],
    version,
  };

  return tracing;
}

// Little helper to load a list of agglomerate skeletons in a test.
// Should be done before any other mapping changes. Else the assumptions of the tests are not correct.
// The agglomerate ids must correspond to one of the agglomerate positions.
// Should be the case initially for all proofreading tests.
export function* loadAgglomerateSkeletons(
  context: WebknossosTestContext,
  agglomerateIdsToLoad: number[],
  shouldSaveAfterLoadingTrees: boolean,
  isInLiveCollabMode: boolean,
): Saga<TreeMap> {
  // Restore original parsing of tracings to make the mocked agglomerate skeleton implementation work.
  vi.mocked(context.mocks.parseProtoTracing).mockRestore();
  for (let index = 0; index < agglomerateIdsToLoad.length; ++index) {
    const agglomerateId = agglomerateIdsToLoad[index];
    yield call(loadAgglomerateSkeletonAtPosition, [agglomerateId, agglomerateId, agglomerateId]);
    // Wait until skeleton saga has loaded the skeleton.
    if (isInLiveCollabMode) {
      yield take("DONE_SAVING");
    } else {
      yield take("ADD_TREES_AND_GROUPS");
    }
  }
  if (shouldSaveAfterLoadingTrees) {
    yield call(() => context.api.tracing.save()); // Also pulls newest version from backend.
  }
  return yield* select((state) =>
    getTreesWithType(state.annotation.skeleton!, TreeTypeEnum.AGGLOMERATE),
  );
}
