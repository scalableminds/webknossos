// @flow

import test from "ava";
import _ from "lodash";
import mock from "mock-require";
import { defaultState } from "oxalis/store";
import update from "immutability-helper";
import DiffableMap from "libs/diffable_map";
import type { NodeType } from "oxalis/store";

const TIMESTAMP = 123456789;
const DateMock = {
  now: () => TIMESTAMP,
};
const buildInfo = {
  webknossos: {
    commitHash: "fc0ea6432ec7107e8f9b5b308ee0e90eae0e7b17",
  },
};
mock("libs/date", DateMock);
const { serializeToNml, getNmlName, parseNml } = mock.reRequire("oxalis/model/helpers/nml_helpers");
const SkeletonTracingReducer = mock.reRequire("oxalis/model/reducers/skeletontracing_reducer")
  .default;
const SkeletonTracingActions = mock.reRequire("oxalis/model/actions/skeletontracing_actions");

const createDummyNode = (id: number): NodeType => ({
  bitDepth: 8,
  id,
  position: [id, id, id],
  radius: id,
  resolution: 10,
  rotation: [id, id, id],
  timestamp: id,
  viewport: 1,
  interpolation: id % 2 === 0,
});

const tracing = {
  type: "skeleton",
  trees: {
    "1": {
      treeId: 1,
      name: "TestTree-0",
      nodes: new DiffableMap([
        [0, createDummyNode(0)],
        [1, createDummyNode(1)],
        [2, createDummyNode(2)],
        [7, createDummyNode(7)],
      ]),
      timestamp: TIMESTAMP,
      branchPoints: [{ nodeId: 1, timestamp: 0 }, { nodeId: 7, timestamp: 0 }],
      edges: [{ source: 0, target: 1 }, { source: 2, target: 1 }, { source: 1, target: 7 }],
      comments: [{ content: "comment", nodeId: 0 }],
      color: [23, 23, 23],
      isVisible: true,
    },
    "2": {
      treeId: 2,
      name: "TestTree-1",
      nodes: new DiffableMap([
        [4, createDummyNode(4)],
        [5, createDummyNode(5)],
        [6, createDummyNode(6)],
      ]),
      timestamp: TIMESTAMP,
      branchPoints: [],
      edges: [{ source: 4, target: 5 }, { source: 5, target: 6 }],
      comments: [],
      color: [30, 30, 30],
      isVisible: true,
    },
  },
  tracingType: "Explorational",
  name: "",
  activeTreeId: 1,
  activeNodeId: 1,
  annotationId: "annotationId",
  cachedMaxNodeId: 7,
  restrictions: {
    branchPointsAllowed: true,
    allowUpdate: true,
    allowFinish: true,
    allowAccess: true,
    allowDownload: true,
  },
};

const initialState = _.extend({}, defaultState, {
  tracing,
  activeUser: { firstName: "SCM", lastName: "Boy" },
  task: {
    id: 1,
  },
});

async function throwsAsyncParseError(t, fn) {
  try {
    await fn.call();
    t.fail(`Test did not throw, calling the following function: ${fn.toString()}`);
  } catch (e) {
    if (e.name === "NmlParseError") {
      t.true(true);
    } else {
      throw e;
    }
  }
}

test("NML serializing and parsing should yield the same state", async t => {
  const serializedNml = serializeToNml(initialState, initialState.tracing, buildInfo);
  const importedTrees = await parseNml(serializedNml);

  t.deepEqual(initialState.tracing.trees, importedTrees);
});

test("NML Serializer should only serialize visible trees", async t => {
  const state = update(initialState, {
    tracing: { trees: { "1": { isVisible: { $set: false } } } },
  });
  const serializedNml = serializeToNml(state, state.tracing, buildInfo);
  const importedTrees = await parseNml(serializedNml);

  // Tree 1 should not be exported as it is not visible
  delete state.tracing.trees["1"];
  t.deepEqual(state.tracing.trees, importedTrees);
});

test("NML serializer should produce correct NMLs", t => {
  const serializedNml = serializeToNml(initialState, initialState.tracing, buildInfo);

  t.snapshot(serializedNml, { id: "nml" });
});

test("Serialized nml should be correctly named", async t => {
  t.is(getNmlName(initialState), "Test Dataset__1__sboy__tionId.nml");
  const stateWithoutTask = _.omit(initialState, "task");
  t.is(getNmlName(stateWithoutTask), "Test Dataset__explorational__sboy__tionId.nml");
});

test("NML Parser should throw errors for invalid nmls", async t => {
  const invalidCommentState = update(initialState, {
    tracing: { trees: { "2": { comments: { $set: [{ content: "test", nodeId: 99 }] } } } },
  });
  const invalidBranchPointState = update(initialState, {
    tracing: { trees: { "2": { branchPoints: { $set: [{ timestamp: 0, nodeId: 99 }] } } } },
  });
  const invalidEdgeState = update(initialState, {
    tracing: { trees: { "2": { edges: { $set: [{ source: 99, target: 5 }] } } } },
  });
  const disconnectedTreeState = update(initialState, {
    tracing: { trees: { "2": { edges: { $set: [{ source: 4, target: 5 }] } } } },
  });
  const nmlWithInvalidComment = serializeToNml(
    invalidCommentState,
    invalidCommentState.tracing,
    buildInfo,
  );
  const nmlWithInvalidBranchPoint = serializeToNml(
    invalidBranchPointState,
    invalidBranchPointState.tracing,
    buildInfo,
  );
  const nmlWithInvalidEdge = serializeToNml(invalidEdgeState, invalidEdgeState.tracing, buildInfo);
  const nmlWithDisconnectedTree = serializeToNml(
    disconnectedTreeState,
    disconnectedTreeState.tracing,
    buildInfo,
  );

  // TODO AVAs t.throws doesn't properly work with async functions yet, see https://github.com/avajs/ava/issues/1371
  await throwsAsyncParseError(t, () => parseNml(nmlWithInvalidComment));
  await throwsAsyncParseError(t, () => parseNml(nmlWithInvalidBranchPoint));
  await throwsAsyncParseError(t, () => parseNml(nmlWithInvalidEdge));
  await throwsAsyncParseError(t, () => parseNml(nmlWithDisconnectedTree));
});

test("addTrees reducer should assign new node and tree ids", t => {
  const action = SkeletonTracingActions.addTreesAction(initialState.tracing.trees);
  const newState = SkeletonTracingReducer(initialState, action);

  t.not(newState, initialState);

  // This should be unchanged / sanity check
  t.is(newState.tracing.name, initialState.tracing.name);
  t.is(newState.tracing.activeTreeId, initialState.tracing.activeTreeId);

  // New node and tree ids should have been assigned
  t.is(_.size(newState.tracing.trees), 4);
  t.is(newState.tracing.trees[3].treeId, 3);
  t.is(newState.tracing.trees[4].treeId, 4);
  t.is(newState.tracing.trees[3].nodes.size(), 4);
  t.is(newState.tracing.trees[3].nodes.get(8).id, 8);
  t.is(newState.tracing.trees[3].nodes.get(9).id, 9);
  t.is(newState.tracing.trees[4].nodes.size(), 3);
  t.is(newState.tracing.trees[4].nodes.get(12).id, 12);

  // And node ids in edges, branchpoints and comments should have been replaced
  t.deepEqual(newState.tracing.trees[3].edges, [
    { source: 8, target: 9 },
    { source: 10, target: 9 },
    { source: 9, target: 11 },
  ]);
  t.deepEqual(newState.tracing.trees[3].branchPoints, [
    { nodeId: 9, timestamp: 0 },
    { nodeId: 11, timestamp: 0 },
  ]);
  t.deepEqual(newState.tracing.trees[3].comments, [{ content: "comment", nodeId: 8 }]);
  t.deepEqual(newState.tracing.trees[4].edges, [
    { source: 12, target: 13 },
    { source: 13, target: 14 },
  ]);
});
