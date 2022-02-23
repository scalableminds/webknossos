// @noflow

// Integration tests for skeleton.js

import _ from "lodash";

import { getSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import * as Utils from "libs/utils";
import mockRequire from "mock-require";
import test from "ava";

import { tracing, annotation } from "../fixtures/skeletontracing_server_objects";

mockRequire.stopAll();
mockRequire("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });
const NodeShader = mockRequire.reRequire("oxalis/geometries/materials/node_shader");
const Store = mockRequire.reRequire("oxalis/store").default;
const Skeleton = mockRequire.reRequire("oxalis/geometries/skeleton").default;
const {
  createNodeAction,
  createTreeAction,
  deleteNodeAction,
  createBranchPointAction,
  setNodeRadiusAction,
  initializeSkeletonTracingAction,
} = mockRequire.reRequire("oxalis/model/actions/skeletontracing_actions");
const { initializeAnnotationAction } = mockRequire.reRequire(
  "oxalis/model/actions/annotation_actions",
);

test.before(t => {
  const rotation = [0.5, 0.5, 0.5];
  const viewport = 0;
  const resolution = 0;

  tracing.trees = [];
  delete tracing.activeNodeId;
  Store.dispatch(initializeAnnotationAction(annotation));
  Store.dispatch(initializeSkeletonTracingAction(tracing));

  // Create 20 trees with 100 nodes each
  for (let i = 0; i < 2000; i++) {
    if (i % 100 === 0) {
      Store.dispatch(createTreeAction());
    }
    Store.dispatch(createNodeAction([i, i, i], rotation, viewport, resolution));
  }

  getSkeletonTracing(Store.getState().tracing).map(skeletonTracing => {
    const trees = skeletonTracing.trees;
    t.is(_.size(trees), 20);
    for (const tree of Utils.values(trees)) {
      t.is(tree.nodes.size(), 100);
    }
  });
});

test.serial("Skeleton should initialize correctly using the store's state", t => {
  getSkeletonTracing(Store.getState().tracing).map(skeletonTracing => {
    const trees = skeletonTracing.trees;
    const skeleton = new Skeleton();

    t.is(skeleton.nodes.buffers.length, 1);
    t.is(skeleton.edges.buffers.length, 1);

    const nodeCapacity = 2000;
    const edgeCapacity = 1980;

    let nodePositions = [];
    const nodeTypes = [];
    const nodeRadii = [];
    const nodeIds = [];
    const nodeTreeIds = [];
    let edgePositions = [];
    const edgeTreeIds = [];
    let treeColors = [0, 0, 0, 0]; // tree ids start at index 1 so add one bogus RGB value

    for (const tree of Utils.values(trees)) {
      treeColors = treeColors.concat(skeleton.getTreeRGBA(tree.color, tree.isVisible));
      for (const node of Array.from(tree.nodes.values())) {
        nodePositions = nodePositions.concat(node.position);
        nodeTreeIds.push(tree.treeId);
        nodeRadii.push(node.radius);
        nodeIds.push(node.id);
        nodeTypes.push(NodeShader.NodeTypes.NORMAL);
      }
      for (const edge of tree.edges.all()) {
        const sourcePosition = tree.nodes.get(edge.source).position;
        const targetPosition = tree.nodes.get(edge.target).position;
        edgePositions = edgePositions.concat(sourcePosition).concat(targetPosition);
        edgeTreeIds.push(tree.treeId, tree.treeId);
      }
    }

    const nodeBufferGeometryAttributes = skeleton.nodes.buffers[0].geometry.attributes;
    t.is(nodeBufferGeometryAttributes.position.array.length, 3 * nodeCapacity);
    t.is(nodeBufferGeometryAttributes.radius.array.length, nodeCapacity);
    t.is(nodeBufferGeometryAttributes.type.array.length, nodeCapacity);
    t.is(nodeBufferGeometryAttributes.nodeId.array.length, nodeCapacity);
    t.is(nodeBufferGeometryAttributes.treeId.array.length, nodeCapacity);

    t.deepEqual(nodeBufferGeometryAttributes.position.array, new Float32Array(nodePositions));
    t.deepEqual(nodeBufferGeometryAttributes.radius.array, new Float32Array(nodeRadii));
    t.deepEqual(nodeBufferGeometryAttributes.type.array, new Float32Array(nodeTypes));
    t.deepEqual(nodeBufferGeometryAttributes.nodeId.array, new Float32Array(nodeIds));
    t.deepEqual(nodeBufferGeometryAttributes.treeId.array, new Float32Array(nodeTreeIds));

    const edgeBufferGeometryAttributes = skeleton.edges.buffers[0].geometry.attributes;
    t.is(edgeBufferGeometryAttributes.position.array.length, 6 * edgeCapacity);
    t.is(edgeBufferGeometryAttributes.treeId.array.length, 2 * edgeCapacity);

    t.deepEqual(edgeBufferGeometryAttributes.position.array, new Float32Array(edgePositions));
    t.deepEqual(edgeBufferGeometryAttributes.treeId.array, new Float32Array(edgeTreeIds));

    const textureData = new Float32Array(
      NodeShader.COLOR_TEXTURE_WIDTH * NodeShader.COLOR_TEXTURE_WIDTH * 4,
    );
    textureData.set(treeColors);
    // Do not use t.deepEqual here, it's extremely slow and takes >15s
    t.true(_.isEqual(skeleton.treeColorTexture.image.data, textureData));
  });
});

test.serial("Skeleton should increase its buffers once the max capacity is reached", async t => {
  const skeleton = new Skeleton();

  Store.dispatch(createNodeAction([2001, 2001, 2001], [0.5, 0.5, 0.5], 0, 0));

  await Utils.sleep(100);
  t.is(skeleton.nodes.buffers.length, 2);
  t.is(skeleton.edges.buffers.length, 2);
});

test.serial("Skeleton should invalidate a node upon deletion", async t => {
  const skeleton = new Skeleton();

  // do index lookup before "dispatch" because index will be deleted as well
  const id = skeleton.combineIds(1, 1);
  const index = skeleton.nodes.idToBufferPosition.get(id).index;

  Store.dispatch(deleteNodeAction(1, 1));
  await Utils.sleep(50);
  t.is(
    skeleton.nodes.buffers[0].geometry.attributes.type.array[index],
    NodeShader.NodeTypes.INVALID,
  );
});

test.serial("Skeleton should invalidate an edge upon deletion", async t => {
  const skeleton = new Skeleton();

  // do index lookup before "dispatch" because index will be deleted as well
  const id = skeleton.combineIds(2, 1);
  const index = skeleton.nodes.idToBufferPosition.get(id).index;

  Store.dispatch(deleteNodeAction(2, 1));
  await Utils.sleep(50);
  t.deepEqual(
    skeleton.edges.buffers[0].geometry.attributes.position.array.subarray(index * 6, index * 6 + 6),
    new Float32Array([0, 0, 0, 0, 0, 0]),
  );
});

test.serial("Skeleton should update node types for branchpoints", async t => {
  const skeleton = new Skeleton();

  Store.dispatch(createBranchPointAction(3, 1));

  await Utils.sleep(50);
  const id = skeleton.combineIds(3, 1);
  const index = skeleton.nodes.idToBufferPosition.get(id).index;
  t.is(
    skeleton.nodes.buffers[0].geometry.attributes.type.array[index],
    NodeShader.NodeTypes.BRANCH_POINT,
  );
});

test.serial.cb("Skeleton should update node radius", t => {
  const skeleton = new Skeleton();

  getSkeletonTracing(Store.getState().tracing).map(async skeletonTracing => {
    const { activeNodeId, activeTreeId } = skeletonTracing;

    Store.dispatch(setNodeRadiusAction(2));

    await Utils.sleep(50);
    const id = skeleton.combineIds(activeNodeId, activeTreeId);
    const index = skeleton.nodes.idToBufferPosition.get(id).index;
    t.is(skeleton.nodes.buffers[0].geometry.attributes.radius.array[index], 2);
    t.end();
  });
});

test.serial.cb("Skeleton should update tree colors upon tree creation", t => {
  const skeleton = new Skeleton();

  Store.dispatch(createTreeAction());
  getSkeletonTracing(Store.getState().tracing).map(async skeletonTracing => {
    const { activeTreeId, trees } = skeletonTracing;
    const activeTree = trees[activeTreeId];
    if (activeTreeId != null) {
      await Utils.sleep(50);
      t.deepEqual(
        skeleton.treeColorTexture.image.data.subarray(activeTreeId * 4, (activeTreeId + 1) * 4),
        new Float32Array(skeleton.getTreeRGBA(activeTree.color, activeTree.isVisible)),
      );
    }
    t.end();
  });
});
