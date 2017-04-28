// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */

import test from "ava";
import mockRequire from "mock-require";
import _ from "lodash";
import { createNodeAction, createTreeAction } from "oxalis/model/actions/skeletontracing_actions";

mockRequire.stopAll();
mockRequire("app", { currentUser: { firstName: "SCM", lastName: "Boy" } });
mockRequire("libs/window", {
  alert: console.log.bind(console),
  requestAnimationFrame: resolve => resolve(),
  app: null,
});
const Utils = mockRequire.reRequire("libs/utils").default;
const NodeShader = mockRequire.reRequire("oxalis/geometries/materials/node_shader");
const Store = mockRequire.reRequire("oxalis/store").default;
const Skeleton = mockRequire.reRequire("oxalis/geometries/skeleton").default;

test.before((t) => {
  const rotation = [0.5, 0.5, 0.5];
  const viewport = 0;
  const resolution = 0;

  // create 20 trees with 100 nodes each
  for (let i = 0; i < 2000; i++) {
    if (i % 100 === 0) {
      Store.dispatch(createTreeAction());
    }
    Store.dispatch(createNodeAction([i, i, i], rotation, viewport, resolution));
  }
  const trees = Store.getState().skeletonTracing.trees;
  t.is(_.size(trees), 20);
  for (const tree of Object.values(trees)) {
    t.is(_.size(tree.nodes), 100);
  }
});

test("Skeleton should initialize correctly using the store's state", (t) => {
  const trees = Store.getState().skeletonTracing.trees;
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
  let treeColors = [0,0,0]; // tree ids start at index 1

  for (const tree of Object.values(trees)) {
    treeColors = treeColors.concat(tree.color);
    for (const node of Object.values(tree.nodes)) {
      nodePositions = nodePositions.concat(node.position);
      nodeTreeIds.push(tree.treeId);
      nodeRadii.push(node.radius);
      nodeIds.push(node.id);
      nodeTypes.push(NodeShader.NodeTypes.NORMAL);
    }
    for (const edge of tree.edges) {
      const sourcePosition = tree.nodes[edge.source].position;
      const targetPosition = tree.nodes[edge.target].position;
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

  const textureData = new Float32Array(NodeShader.COLOR_TEXTURE_WIDTH * NodeShader.COLOR_TEXTURE_WIDTH * 3);
  textureData.set(treeColors);
  t.deepEqual(skeleton.treeColorTexture.image.data, textureData);
});

test("Skeleton should increase buffer once the max capacity is reached", async (t) => {
  const skeleton = new Skeleton();

  Store.dispatch(createNodeAction([2001, 2001, 2001], [0.5, 0.5, 0.5], 0, 0));
  console.log("blub", skeleton.nodes.buffers)
  await Utils.sleep(5)
  t.is(skeleton.nodes.buffers.length, 2);
  t.is(skeleton.edges.buffers.length, 2);
});

