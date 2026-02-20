import DiffableMap from "libs/diffable_map";
import { initialSkeletonTracing } from "test/fixtures/hybridtracing_object";
import EdgeCollection from "viewer/model/edge_collection";
import {
  createPositionToIdMap,
  deepDiffTreesInSkeletonTracings,
  remapNodeIdsWithPositionMap,
} from "viewer/model/sagas/volume/proofreading/agglomerate_skeleton_syncing_saga_helpers";
import type { Node, Tree } from "viewer/model/types/tree_types";
import type { SkeletonTracing } from "viewer/store";
import { describe, expect, it } from "vitest";

function createNode(id: number): Node {
  return {
    id,
    untransformedPosition: [id, id, id],
    additionalCoordinates: null,
    rotation: [0, 0, 0],
    bitDepth: 2,
    viewport: 0,
    mag: 0,
    radius: 5,
    timestamp: 0,
    interpolation: false,
  };
}

function createTree(id: number, nodes: DiffableMap<number, Node>, edges: EdgeCollection): Tree {
  return {
    treeId: id,
    groupId: undefined,
    color: [255, 255, 255],
    name: "",
    timestamp: 0,
    comments: [],
    branchPoints: [],
    edges,
    isVisible: false,
    nodes,
    type: "AGGLOMERATE",
    edgesAreVisible: false,
    metadata: [],
  };
}

// Note: The full integration whether the functions in agglomerate_skeleton_syncing_saga_helpers.ts are correctly detecting agglomerate skeleton updates
// and transforming them to applicable update actions is tested in proofreading_agglomerate_skeleton_syncing.spec.ts.
// So no need to redo this here.
describe("Agglomerate Skeleton Syncing Helpers", () => {
  it("createPositionToIdMap should create a correct position to nodeId map for accurate remapping of newly loaded agglomerate skeletons.", () => {
    const nodes1 = new DiffableMap<number, Node>([
      [1, createNode(1)],
      [2, createNode(2)],
      [3, createNode(3)],
    ]);
    const nodes2 = new DiffableMap<number, Node>([
      [4, createNode(4)],
      [5, createNode(5)],
    ]);
    const edges1 = new EdgeCollection().addEdges([
      { source: 1, target: 2 },
      { source: 2, target: 3 },
    ]);
    const edges2 = new EdgeCollection().addEdges([{ source: 4, target: 5 }]);
    const tree1: Tree = createTree(1, nodes1, edges1);
    const tree2: Tree = createTree(2, nodes2, edges2);
    const positionToIdMap = createPositionToIdMap([tree1, tree2]);
    expect(positionToIdMap).toStrictEqual({
      "1,1,1": 1,
      "2,2,2": 2,
      "3,3,3": 3,
      "4,4,4": 4,
      "5,5,5": 5,
    });
  });

  it("remapNodeIdsWithPositionMap should remap the ids of trees which are fully present in the PositionToIdMap.", () => {
    const positionToIdMap = { "1,1,1": 1, "2,2,2": 2, "3,3,3": 3, "4,4,4": 4, "5,5,5": 5 };
    const nodes1 = new DiffableMap<number, Node>([
      [10, { ...createNode(10), untransformedPosition: [1, 1, 1] }],
      [11, { ...createNode(11), untransformedPosition: [2, 2, 2] }],
      [12, { ...createNode(12), untransformedPosition: [3, 3, 3] }],
    ]);
    const nodes2 = new DiffableMap<number, Node>([
      [13, { ...createNode(13), untransformedPosition: [4, 4, 4] }],
      [14, { ...createNode(14), untransformedPosition: [5, 5, 5] }],
    ]);
    const edges1 = new EdgeCollection().addEdges([
      { source: 10, target: 11 },
      { source: 11, target: 12 },
    ]);
    const edges2 = new EdgeCollection().addEdges([{ source: 13, target: 14 }]);
    const tree1 = createTree(10, nodes1, edges1);
    const tree2 = createTree(11, nodes2, edges2);
    // Fill in required skeletontracing with initialSkeletonTracing as only its cachedMaxNodeId is used.
    // cachedMaxNodeId needs to be 5 as this it the max id in positionToIdMap.
    const dummyTracing = { ...initialSkeletonTracing, cachedMaxNodeId: 5 };
    const [remappedTree1, remappedTree2] = remapNodeIdsWithPositionMap(
      [tree1, tree2],
      positionToIdMap,
      dummyTracing,
    );
    expect([...remappedTree1.nodes.values()]).toStrictEqual([
      createNode(1),
      createNode(2),
      createNode(3),
    ]);
    expect([...remappedTree2.nodes.values()]).toStrictEqual([createNode(4), createNode(5)]);
    expect([...remappedTree1.edges.values()]).toStrictEqual([
      { source: 1, target: 2 },
      { source: 2, target: 3 },
    ]);
    expect([...remappedTree2.edges.values()]).toStrictEqual([{ source: 4, target: 5 }]);
  });

  it("remapNodeIdsWithPositionMap should remap the ids of a tree which is partially present in the PositionToIdMap.", () => {
    const positionToIdMap = { "1,1,1": 1, "2,2,2": 2, "3,3,3": 3 };
    const nodes = new DiffableMap<number, Node>([
      [10, { ...createNode(10), untransformedPosition: [1, 1, 1] }],
      [11, { ...createNode(11), untransformedPosition: [2, 2, 2] }],
      [12, { ...createNode(12), untransformedPosition: [3, 3, 3] }],
      [13, { ...createNode(13), untransformedPosition: [4, 4, 4] }],
      [14, { ...createNode(14), untransformedPosition: [5, 5, 5] }],
    ]);
    const edges = new EdgeCollection().addEdges([
      { source: 10, target: 11 },
      { source: 11, target: 12 },
      { source: 12, target: 13 },
      { source: 13, target: 14 },
    ]);
    const tree = createTree(10, nodes, edges);
    // Fill in required skeletontracing with initialSkeletonTracing as only its cachedMaxNodeId is used.
    // cachedMaxNodeId needs to be at least 3 as this it the max id in positionToIdMap.
    // Here we take 5 to simulate, that there is another tree present which has 2 nodes but is not considered in this operation.
    // Thus, the no mappable nodes should start their id with 6 and then increase it.
    const dummyTracing = { ...initialSkeletonTracing, cachedMaxNodeId: 5 };
    const [remappedTree] = remapNodeIdsWithPositionMap([tree], positionToIdMap, dummyTracing);
    expect([...remappedTree.nodes.values()]).toStrictEqual([
      createNode(1),
      createNode(2),
      createNode(3),
      { ...createNode(6), untransformedPosition: [4, 4, 4] },
      { ...createNode(7), untransformedPosition: [5, 5, 5] },
    ]);
    expect([...remappedTree.edges.values()]).toStrictEqual([
      { source: 1, target: 2 },
      { source: 2, target: 3 },
      { source: 3, target: 6 },
      { source: 6, target: 7 },
    ]);
  });

  it("remapNodeIdsWithPositionMap should remap the ids of a tree according to cachedMaxNodeId when no node is present in the PositionToIdMap.", () => {
    const positionToIdMap = { "1,1,1": 1, "2,2,2": 2, "3,3,3": 3, "4,4,4": 4, "5,5,5": 5 };
    const nodes1 = new DiffableMap<number, Node>([
      [10, { ...createNode(10), untransformedPosition: [1, 1, 1] }],
      [11, { ...createNode(11), untransformedPosition: [2, 2, 2] }],
      [12, { ...createNode(12), untransformedPosition: [3, 3, 3] }],
    ]);
    const nodes2 = new DiffableMap<number, Node>([
      [13, { ...createNode(13), untransformedPosition: [4, 4, 4] }],
      [14, { ...createNode(14), untransformedPosition: [5, 5, 5] }],
    ]);
    const edges1 = new EdgeCollection().addEdges([
      { source: 10, target: 11 },
      { source: 11, target: 12 },
    ]);
    const edges2 = new EdgeCollection().addEdges([{ source: 13, target: 14 }]);
    const tree1 = createTree(10, nodes1, edges1);
    const tree2 = createTree(11, nodes2, edges2);
    // Fill in required skeletontracing with initialSkeletonTracing as only its cachedMaxNodeId is used.
    // cachedMaxNodeId needs to be 5 as this it the max id in positionToIdMap.
    const dummyTracing = { ...initialSkeletonTracing, cachedMaxNodeId: 5 };
    const [remappedTree1, remappedTree2] = remapNodeIdsWithPositionMap(
      [tree1, tree2],
      positionToIdMap,
      dummyTracing,
    );
    expect([...remappedTree1.nodes.values()]).toStrictEqual([
      createNode(1),
      createNode(2),
      createNode(3),
    ]);
    expect([...remappedTree2.nodes.values()]).toStrictEqual([createNode(4), createNode(5)]);
    expect([...remappedTree1.edges.values()]).toStrictEqual([
      { source: 1, target: 2 },
      { source: 2, target: 3 },
    ]);
    expect([...remappedTree2.edges.values()]).toStrictEqual([{ source: 4, target: 5 }]);
  });

  it("deepDiffTreesInSkeletonTracings should yield correct update actions", () => {
    const nodes1 = new DiffableMap<number, Node>([
      [1, createNode(1)],
      [2, createNode(2)],
      [3, createNode(3)],
    ]);
    const nodes2 = new DiffableMap<number, Node>([
      [1, createNode(1)],
      [2, createNode(2)],
      [3, createNode(3)],
      [4, createNode(4)],
      [5, createNode(5)],
    ]);
    const edges1 = new EdgeCollection().addEdges([
      { source: 1, target: 2 },
      { source: 2, target: 3 },
    ]);
    const edges2 = new EdgeCollection().addEdges([
      { source: 1, target: 2 },
      { source: 2, target: 3 },
      { source: 3, target: 4 },
      { source: 4, target: 5 },
    ]);
    const tree1: Tree = createTree(1, nodes1, edges1);
    const tree2: Tree = createTree(1, nodes2, edges2);
    const tracing1: SkeletonTracing = {
      ...initialSkeletonTracing,
      cachedMaxNodeId: 3,
      trees: new DiffableMap<number, Tree>([[1, tree1]]),
    };
    const tracing2: SkeletonTracing = {
      ...initialSkeletonTracing,
      cachedMaxNodeId: 5,
      trees: new DiffableMap<number, Tree>([[1, tree2]]),
    };
    const actions = deepDiffTreesInSkeletonTracings(tracing1, tracing2);
    expect(actions).toStrictEqual([
      {
        name: "createNode",
        value: {
          actionTracingId: "skeletonTracingId",
          id: 4,
          additionalCoordinates: null,
          rotation: [0, 0, 0],
          bitDepth: 2,
          viewport: 0,
          radius: 5,
          timestamp: 0,
          interpolation: false,
          position: [4, 4, 4],
          treeId: 1,
          resolution: 0,
        },
      },
      {
        name: "createNode",
        value: {
          actionTracingId: "skeletonTracingId",
          id: 5,
          additionalCoordinates: null,
          rotation: [0, 0, 0],
          bitDepth: 2,
          viewport: 0,
          radius: 5,
          timestamp: 0,
          interpolation: false,
          position: [5, 5, 5],
          treeId: 1,
          resolution: 0,
        },
      },
      {
        name: "createEdge",
        value: {
          actionTracingId: "skeletonTracingId",
          treeId: 1,
          source: 3,
          target: 4,
        },
      },
      {
        name: "createEdge",
        value: {
          actionTracingId: "skeletonTracingId",
          treeId: 1,
          source: 4,
          target: 5,
        },
      },
    ]);
  });
});
