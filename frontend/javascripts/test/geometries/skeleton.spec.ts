// Integration tests for skeleton.ts
// Ensure singletons are set up
import "test/helpers/apiHelpers";
import { sleep } from "libs/utils";
import isEqual from "lodash-es/isEqual";
import type { Vector3 } from "viewer/constants";
import { COLOR_TEXTURE_WIDTH, NodeTypes } from "viewer/geometries/materials/node_shader";
import Skeleton from "viewer/geometries/skeleton";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  batchedAnnotationInitializationAction,
  initializeAnnotationAction,
} from "viewer/model/actions/annotation_actions";
import {
  createBranchPointAction,
  createNodeAction,
  createTreeAction,
  deleteNodeAction,
  initializeSkeletonTracingAction,
  setNodeRadiusAction,
  setTreeMetadataAction,
  setTreeVisibilityAction,
} from "viewer/model/actions/skeletontracing_actions";
import { getAgglomerateDiffMetadata } from "viewer/model/helpers/agglomerate_diff_helpers";
import { convertServerAnnotationToFrontendAnnotation } from "viewer/model/reducers/reducer_helpers";
import type { WebknossosState } from "viewer/store";
import Store from "viewer/store";
import { beforeAll, describe, expect, it } from "vitest";
import { annotation, tracing } from "../fixtures/skeletontracing_server_objects";

const skeletonCreator = () =>
  new Skeleton((state: WebknossosState) => enforceSkeletonTracing(state.annotation), true);

describe("Skeleton", () => {
  beforeAll(() => {
    const rotation = [0.5, 0.5, 0.5] as Vector3;
    const viewport = 0;
    const mag = 0;
    tracing.trees = [];
    delete tracing.activeNodeId;
    Store.dispatch(
      batchedAnnotationInitializationAction([
        initializeAnnotationAction(convertServerAnnotationToFrontendAnnotation(annotation, 0, 0)),
        initializeSkeletonTracingAction(tracing),
      ]),
    );

    // Create 20 trees with 100 nodes each
    for (let i = 0; i < 2000; i++) {
      if (i % 100 === 0) {
        Store.dispatch(createTreeAction());
      }

      Store.dispatch(createNodeAction([i, i, i] as Vector3, null, rotation, viewport, mag));
    }

    const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);
    const trees = skeletonTracing.trees;
    expect(trees.size()).toBe(20);

    for (const tree of trees.values()) {
      expect(tree.nodes.size()).toBe(100);
    }
  });

  it("should initialize correctly using the store's state", () => {
    const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);
    const trees = skeletonTracing.trees;
    const skeleton = skeletonCreator();
    expect(skeleton.nodes.buffers.length).toBe(1);
    expect(skeleton.edges.buffers.length).toBe(1);

    const nodeCapacity = 2000;
    const edgeCapacity = 1980;
    let nodePositions: Vector3[] = [];
    const nodeTypes: number[] = [];
    const nodeRadii: number[] = [];
    const nodeIds: number[] = [];
    const nodeTreeIds: number[] = [];
    let edgePositions: Vector3[] = [];
    const edgeTreeIds: number[] = [];
    let treeColors = [0, 0, 0, 0]; // tree ids start at index 1 so add one bogus RGB value

    for (const tree of trees.values()) {
      treeColors = treeColors.concat(
        skeleton.getTreeRGBA(tree.color, tree.isVisible, tree.edgesAreVisible),
      );

      for (const node of tree.nodes.values()) {
        nodePositions = nodePositions.concat(node.untransformedPosition);
        nodeTreeIds.push(tree.treeId);
        nodeRadii.push(node.radius);
        nodeIds.push(node.id);
        nodeTypes.push(NodeTypes.NORMAL);
      }

      for (const edge of tree.edges.all()) {
        const sourcePosition = tree.nodes.getOrThrow(edge.source).untransformedPosition;
        const targetPosition = tree.nodes.getOrThrow(edge.target).untransformedPosition;

        edgePositions = edgePositions.concat(sourcePosition).concat(targetPosition);
        edgeTreeIds.push(tree.treeId, tree.treeId);
      }
    }

    const nodeBufferGeometryAttributes = skeleton.nodes.buffers[0].geometry.attributes;
    expect(nodeBufferGeometryAttributes.position.array.length).toBe(3 * nodeCapacity);
    expect(nodeBufferGeometryAttributes.radius.array.length).toBe(nodeCapacity);
    expect(nodeBufferGeometryAttributes.type.array.length).toBe(nodeCapacity);
    expect(nodeBufferGeometryAttributes.nodeId.array.length).toBe(nodeCapacity);
    expect(nodeBufferGeometryAttributes.treeId.array.length).toBe(nodeCapacity);
    expect(nodeBufferGeometryAttributes.position.array).toEqual(
      new Float32Array(nodePositions as any as number[]),
    );
    expect(nodeBufferGeometryAttributes.radius.array).toEqual(new Float32Array(nodeRadii));
    expect(nodeBufferGeometryAttributes.type.array).toEqual(new Float32Array(nodeTypes));
    expect(nodeBufferGeometryAttributes.nodeId.array).toEqual(new Float32Array(nodeIds));
    expect(nodeBufferGeometryAttributes.treeId.array).toEqual(new Float32Array(nodeTreeIds));
    const edgeBufferGeometryAttributes = skeleton.edges.buffers[0].geometry.attributes;
    expect(edgeBufferGeometryAttributes.position.array.length).toBe(6 * edgeCapacity);
    expect(edgeBufferGeometryAttributes.treeId.array.length).toBe(2 * edgeCapacity);
    expect(edgeBufferGeometryAttributes.position.array).toEqual(
      new Float32Array(edgePositions as any as number[]),
    );
    expect(edgeBufferGeometryAttributes.treeId.array).toEqual(new Float32Array(edgeTreeIds));
    const textureData = new Float32Array(COLOR_TEXTURE_WIDTH * COLOR_TEXTURE_WIDTH * 4);
    textureData.set(treeColors);

    // Using isEqual from lodash as noted in the original test
    expect(isEqual(skeleton.treeColorTexture.image.data, textureData)).toBe(true);
  });

  it("should increase its buffers once the max capacity is reached", async () => {
    const skeleton = skeletonCreator();

    Store.dispatch(createNodeAction([2001, 2001, 2001], null, [0.5, 0.5, 0.5], 0, 0));
    await sleep(100);

    expect(skeleton.nodes.buffers.length).toBe(2);
    expect(skeleton.edges.buffers.length).toBe(2);
  });

  it("should invalidate a node upon deletion", async () => {
    const skeleton = skeletonCreator();
    // do index lookup before "dispatch" because index will be deleted as well
    const id = skeleton.combineIds(1, 1);
    const index = skeleton.nodes.idToBufferPosition.get(id)!.index;

    Store.dispatch(deleteNodeAction(1, 1));
    await sleep(50);

    expect(skeleton.nodes.buffers[0].geometry.attributes.type.array[index]).toBe(NodeTypes.INVALID);
  });

  it("should invalidate an edge upon deletion", async () => {
    const skeleton = skeletonCreator();
    // do index lookup before "dispatch" because index will be deleted as well
    const id = skeleton.combineIds(2, 1);
    const index = skeleton.nodes.idToBufferPosition.get(id)!.index;
    Store.dispatch(deleteNodeAction(2, 1));
    await sleep(50);

    // Use Array.from to handle array subarray properly
    const positionArray = skeleton.edges.buffers[0].geometry.attributes.position.array;
    const segment = Array.from(positionArray).slice(index * 6, index * 6 + 6);
    expect(segment).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("should update node types for branchpoints", async () => {
    const skeleton = skeletonCreator();
    Store.dispatch(createBranchPointAction(3, 1));

    await sleep(50);
    const id = skeleton.combineIds(3, 1);
    const index = skeleton.nodes.idToBufferPosition.get(id)!.index;

    expect(skeleton.nodes.buffers[0].geometry.attributes.type.array[index]).toBe(
      NodeTypes.BRANCH_POINT,
    );
  });

  it("should update node radius", async () => {
    const skeleton = skeletonCreator();
    const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);
    const { activeNodeId } = skeletonTracing;
    const { activeTreeId } = Store.getState().localSkeletonState;

    Store.dispatch(setNodeRadiusAction(2));
    await sleep(50);
    const id = skeleton.combineIds(activeNodeId!, activeTreeId!);
    const index = skeleton.nodes.idToBufferPosition.get(id)!.index;

    expect(skeleton.nodes.buffers[0].geometry.attributes.radius.array[index]).toBe(2);
  });

  it("should update tree colors upon tree creation", async () => {
    const skeleton = skeletonCreator();
    Store.dispatch(createTreeAction());
    const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);
    const { trees } = skeletonTracing;
    const { activeTreeId } = Store.getState().localSkeletonState;

    if (activeTreeId != null) {
      const activeTree = trees.getOrThrow(activeTreeId);

      await sleep(50);
      expect(
        skeleton.treeColorTexture.image.data.subarray(activeTreeId * 4, (activeTreeId + 1) * 4),
      ).toEqual(
        new Float32Array(
          skeleton.getTreeRGBA(activeTree.color, activeTree.isVisible, activeTree.edgesAreVisible),
        ),
      );
    }
  });

  it("should draw the nodes and edges of agglomerate diff trees in the priority buffers", async () => {
    const skeleton = skeletonCreator();
    const treeId = 5;
    const tree = enforceSkeletonTracing(Store.getState().annotation).trees.getOrThrow(treeId);
    const edgeIds = tree.edges
      .all()
      .map((edge) => skeleton.combineIds(treeId, edge.source, edge.target))
      .toArray();
    expect(edgeIds.length).toBeGreaterThan(0);
    const nodeIds = tree.nodes
      .values()
      .map((node) => skeleton.combineIds(node.id, treeId))
      .toArray();
    const branchPointNodeId = tree.nodes.values().next().value!.id;
    Store.dispatch(createBranchPointAction(branchPointNodeId, treeId));
    await sleep(50);
    const isInPriorityBuffers = (id: string) => skeleton.priorityEdges.idToBufferPosition.has(id);
    const isInDefaultBuffers = (id: string) => skeleton.edges.idToBufferPosition.has(id);
    const isInPriorityNodeBuffers = (id: string) =>
      skeleton.priorityNodes.idToBufferPosition.has(id);
    const isInDefaultNodeBuffers = (id: string) => skeleton.nodes.idToBufferPosition.has(id);
    const getNodeType = (nodeId: number) => {
      const id = skeleton.combineIds(nodeId, treeId);
      const { buffer, index } = skeleton.getNodeCollection(id).idToBufferPosition.get(id)!;
      return buffer.geometry.attributes.type.array[index];
    };
    expect(edgeIds.every((id) => isInDefaultBuffers(id) && !isInPriorityBuffers(id))).toBe(true);
    expect(nodeIds.every((id) => isInDefaultNodeBuffers(id) && !isInPriorityNodeBuffers(id))).toBe(
      true,
    );

    Store.dispatch(
      setTreeMetadataAction(
        getAgglomerateDiffMetadata({
          layerName: "segmentation",
          agglomerateId: 1n,
          mappingName: "agglomerate_view_1",
          referenceMappingName: "agglomerate_view_0",
          segmentId: 3n,
          referenceAgglomerateId: 2n,
        }),
        treeId,
      ),
    );
    await sleep(50);
    expect(edgeIds.every((id) => isInPriorityBuffers(id) && !isInDefaultBuffers(id))).toBe(true);
    expect(nodeIds.every((id) => isInPriorityNodeBuffers(id) && !isInDefaultNodeBuffers(id))).toBe(
      true,
    );
    // Moving the nodes keeps their branch point state
    expect(getNodeType(branchPointNodeId)).toBe(NodeTypes.BRANCH_POINT);
    for (const collection of [skeleton.priorityNodes, skeleton.priorityEdges]) {
      expect(collection.buffers.every((buffer) => buffer.mesh.renderOrder > 0)).toBe(true);
    }
    for (const collection of [skeleton.nodes, skeleton.edges]) {
      expect(collection.buffers.every((buffer) => buffer.mesh.renderOrder === 0)).toBe(true);
    }
    // The tree is marked as priority tree via a negative alpha and all other trees are dimmed
    expect(skeleton.treeColorTexture.image.data[treeId * 4 + 3]).toBe(-1);
    expect(skeleton.nodes.material.uniforms.nonPriorityTreeOpacity.value).toBeLessThan(1);
    expect(skeleton.edges.material.uniforms.nonPriorityTreeOpacity.value).toBeLessThan(1);

    // A newly created skeleton puts the edges into the priority buffers right away
    const freshSkeleton = skeletonCreator();
    expect(edgeIds.every((id) => freshSkeleton.priorityEdges.idToBufferPosition.has(id))).toBe(
      true,
    );
    expect(nodeIds.every((id) => freshSkeleton.priorityNodes.idToBufferPosition.has(id))).toBe(
      true,
    );

    // Hiding the priority tree removes the dimming
    Store.dispatch(setTreeVisibilityAction(treeId, false));
    await sleep(50);
    expect(skeleton.nodes.material.uniforms.nonPriorityTreeOpacity.value).toBe(1);
    Store.dispatch(setTreeVisibilityAction(treeId, true));
    await sleep(50);
    expect(skeleton.nodes.material.uniforms.nonPriorityTreeOpacity.value).toBeLessThan(1);

    Store.dispatch(setTreeMetadataAction([], treeId));
    await sleep(50);
    expect(edgeIds.every((id) => isInDefaultBuffers(id) && !isInPriorityBuffers(id))).toBe(true);
    expect(nodeIds.every((id) => isInDefaultNodeBuffers(id) && !isInPriorityNodeBuffers(id))).toBe(
      true,
    );
    expect(getNodeType(branchPointNodeId)).toBe(NodeTypes.BRANCH_POINT);
    expect(skeleton.treeColorTexture.image.data[treeId * 4 + 3]).toBe(1);
    expect(skeleton.nodes.material.uniforms.nonPriorityTreeOpacity.value).toBe(1);
  });
});
