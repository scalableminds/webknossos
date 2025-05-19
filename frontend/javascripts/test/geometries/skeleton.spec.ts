// Integration tests for skeleton.js
// Ensure singletons are set up
import "test/helpers/apiHelpers";
import _ from "lodash";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import * as Utils from "libs/utils";
import { describe, it, beforeAll, expect } from "vitest";
import type { Vector3 } from "viewer/constants";
import type { WebknossosState } from "viewer/store";
import { tracing, annotation } from "../fixtures/skeletontracing_server_objects";
import { convertServerAnnotationToFrontendAnnotation } from "viewer/model/reducers/reducer_helpers";
import { batchedAnnotationInitializationAction } from "viewer/model/actions/annotation_actions";

import { COLOR_TEXTURE_WIDTH, NodeTypes } from "viewer/geometries/materials/node_shader";
import Store from "viewer/store";
import Skeleton from "viewer/geometries/skeleton";
import {
  createNodeAction,
  createTreeAction,
  deleteNodeAction,
  createBranchPointAction,
  setNodeRadiusAction,
  initializeSkeletonTracingAction,
} from "viewer/model/actions/skeletontracing_actions";
import { initializeAnnotationAction } from "viewer/model/actions/annotation_actions";

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
    expect(_.size(trees)).toBe(20);

    for (const tree of Utils.values(trees)) {
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

    for (const tree of Utils.values(trees)) {
      treeColors = treeColors.concat(
        skeleton.getTreeRGBA(tree.color, tree.isVisible, tree.edgesAreVisible),
      );

      for (const node of Array.from(tree.nodes.values())) {
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
    expect(_.isEqual(skeleton.treeColorTexture.image.data, textureData)).toBe(true);
  });

  it("should increase its buffers once the max capacity is reached", async () => {
    const skeleton = skeletonCreator();
    Store.dispatch(createNodeAction([2001, 2001, 2001], null, [0.5, 0.5, 0.5], 0, 0));
    await Utils.sleep(100);
    expect(skeleton.nodes.buffers.length).toBe(2);
    expect(skeleton.edges.buffers.length).toBe(2);
  });

  it("should invalidate a node upon deletion", async () => {
    const skeleton = skeletonCreator();
    // do index lookup before "dispatch" because index will be deleted as well
    const id = skeleton.combineIds(1, 1);
    const index = skeleton.nodes.idToBufferPosition.get(id)!.index;
    Store.dispatch(deleteNodeAction(1, 1));
    await Utils.sleep(50);
    expect(skeleton.nodes.buffers[0].geometry.attributes.type.array[index]).toBe(NodeTypes.INVALID);
  });

  it("should invalidate an edge upon deletion", async () => {
    const skeleton = skeletonCreator();
    // do index lookup before "dispatch" because index will be deleted as well
    const id = skeleton.combineIds(2, 1);
    const index = skeleton.nodes.idToBufferPosition.get(id)!.index;
    Store.dispatch(deleteNodeAction(2, 1));
    await Utils.sleep(50);

    // Use Array.from to handle array subarray properly
    const positionArray = skeleton.edges.buffers[0].geometry.attributes.position.array;
    const segment = Array.from(positionArray).slice(index * 6, index * 6 + 6);
    expect(segment).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("should update node types for branchpoints", async () => {
    const skeleton = skeletonCreator();
    Store.dispatch(createBranchPointAction(3, 1));
    await Utils.sleep(50);
    const id = skeleton.combineIds(3, 1);
    const index = skeleton.nodes.idToBufferPosition.get(id)!.index;
    expect(skeleton.nodes.buffers[0].geometry.attributes.type.array[index]).toBe(
      NodeTypes.BRANCH_POINT,
    );
  });

  it("should update node radius", async () => {
    const skeleton = skeletonCreator();
    const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);
    const { activeNodeId, activeTreeId } = skeletonTracing;

    Store.dispatch(setNodeRadiusAction(2));
    await Utils.sleep(50);
    const id = skeleton.combineIds(activeNodeId!, activeTreeId!);
    const index = skeleton.nodes.idToBufferPosition.get(id)!.index;
    expect(skeleton.nodes.buffers[0].geometry.attributes.radius.array[index]).toBe(2);
  });

  it("should update tree colors upon tree creation", async () => {
    const skeleton = skeletonCreator();
    Store.dispatch(createTreeAction());
    const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);
    const { activeTreeId, trees } = skeletonTracing;

    if (activeTreeId != null) {
      const activeTree = trees[activeTreeId];

      await Utils.sleep(50);
      expect(
        skeleton.treeColorTexture.image.data.subarray(activeTreeId * 4, (activeTreeId + 1) * 4),
      ).toEqual(
        new Float32Array(
          skeleton.getTreeRGBA(activeTree.color, activeTree.isVisible, activeTree.edgesAreVisible),
        ),
      );
    }
  });
});
