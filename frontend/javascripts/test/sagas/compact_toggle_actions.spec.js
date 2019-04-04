// @flow

import type { Flycam } from "oxalis/store";
import { withoutUpdateTracing, withoutUpdateTree } from "test/helpers/saveHelpers";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import { updateTreeGroupVisibility, updateTreeVisibility } from "oxalis/model/sagas/update_actions";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import compactToggleActions from "oxalis/model/helpers/compaction/compact_toggle_actions";
import test from "ava";

const createTree = (id, groupId, isVisible) => ({
  treeId: id,
  name: "TestTree",
  nodes: new DiffableMap(),
  timestamp: 12345678,
  branchPoints: [],
  edges: new EdgeCollection(),
  comments: [],
  color: [23, 23, 23],
  isVisible,
  groupId,
});

const treeGroups = [
  {
    name: "subroot1",
    groupId: 1,
    children: [
      {
        name: "subsubroot1",
        groupId: 3,
        children: [
          {
            name: "subsubsubroot1",
            groupId: 4,
            children: [],
          },
        ],
      },
    ],
  },
  {
    name: "subroot1",
    groupId: 2,
    children: [],
  },
];

const flycamMock = (({}: any): Flycam);

const createState = (trees, _treeGroups) => ({
  tracing: {
    skeleton: {
      type: "skeleton",
      treeGroups: _treeGroups,
      trees,
      activeTreeId: 1,
      activeNodeId: null,
      cachedMaxNodeId: 0,
      activeGroupId: null,
    },
    volume: null,
  },
  flycam: flycamMock,
});

const allVisible = createState(
  {
    "1": createTree(1, null, true),
    "2": createTree(2, 1, true),
    "3": createTree(3, 2, true),
    "4": createTree(4, 3, true),
    "5": createTree(5, 3, true),
    "6": createTree(6, 4, true),
  },
  treeGroups,
);

function testDiffing(prevState, nextState) {
  // Let's remove updateTree actions as well, as these will occur here
  // because we don't do shallow updates within the tests (instead, we are
  // are creating completely new trees, so that we don't have to go through the
  // action->reducer pipeline)
  return withoutUpdateTree(
    withoutUpdateTracing(
      Array.from(
        diffSkeletonTracing(
          prevState.tracing.skeleton,
          nextState.tracing.skeleton,
          flycamMock,
          flycamMock,
        ),
      ),
    ),
  );
}

function _updateTreeVisibility(treeId: number, isVisible: boolean) {
  const tree = (({ treeId, isVisible }: any): Tree);
  return updateTreeVisibility(tree);
}

function getActions(initialState, newState) {
  const updateActions = testDiffing(initialState, newState);
  const compactedActions = compactToggleActions(updateActions, newState.tracing);
  return [compactedActions, updateActions];
}

test("compactUpdateActions shouldn't compact a single action", t => {
  const testState = createState(
    {
      "1": createTree(1, null, true),
      "2": createTree(2, 1, true),
      "3": createTree(3, 2, true),
      "4": createTree(4, 3, false),
      "5": createTree(5, 3, true),
      "6": createTree(6, 4, true),
    },
    treeGroups,
  );

  const [compactedActions, updateActions] = getActions(allVisible, testState);

  t.deepEqual(compactedActions, updateActions);
});

test("compactUpdateActions should compact when toggling all trees", t => {
  const testState = createState(
    {
      "1": createTree(1, null, false),
      "2": createTree(2, 1, false),
      "3": createTree(3, 2, false),
      "4": createTree(4, 3, false),
      "5": createTree(5, 3, false),
      "6": createTree(6, 4, false),
    },
    treeGroups,
  );

  const [compactedActions] = getActions(allVisible, testState);

  t.deepEqual(compactedActions, [updateTreeGroupVisibility(undefined, false)]);
});

test("compactUpdateActions should compact when toggling a group", t => {
  // Let's toggle group 3 (which contains group 4)
  const testState = createState(
    {
      "1": createTree(1, null, true),
      "2": createTree(2, 1, true),
      "3": createTree(3, 2, true),
      "4": createTree(4, 3, false),
      "5": createTree(5, 3, false),
      "6": createTree(6, 4, false),
    },
    treeGroups,
  );

  const [compactedActions] = getActions(allVisible, testState);

  t.deepEqual(compactedActions, [updateTreeGroupVisibility(3, false)]);
});

test("compactUpdateActions should compact when toggling a group except for one tree", t => {
  // Let's toggle group 3 (which contains group 4)
  const testState = createState(
    {
      "1": createTree(1, null, false),
      "2": createTree(2, 1, false),
      "3": createTree(3, 2, true),
      "4": createTree(4, 3, false),
      "5": createTree(5, 3, false),
      "6": createTree(6, 4, false),
    },
    treeGroups,
  );

  const [compactedActions] = getActions(allVisible, testState);

  t.deepEqual(compactedActions, [
    updateTreeGroupVisibility(undefined, false),
    _updateTreeVisibility(3, true),
  ]);
});
