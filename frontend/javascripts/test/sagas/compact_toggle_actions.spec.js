// @flow
import _ from "lodash";

import type { Flycam, OxalisState, Tree, TreeMap } from "oxalis/store";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { updateTreeGroupVisibility, updateTreeVisibility } from "oxalis/model/sagas/update_actions";
import { withoutUpdateTracing, withoutUpdateTree } from "test/helpers/saveHelpers";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import compactToggleActions from "oxalis/model/helpers/compaction/compact_toggle_actions";
import defaultState from "oxalis/default_state";
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

const makeTreesObject = trees => ((_.keyBy(trees, "treeId"): any): TreeMap);
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

const createState = (trees, _treeGroups): OxalisState => ({
  ...defaultState,
  tracing: {
    ...defaultState.tracing,
    skeleton: {
      ...defaultState.tracing.skeleton,
      createdTimestamp: 0,
      version: 0,
      tracingId: "tracingId",
      boundingBox: null,
      userBoundingBoxes: [],
      type: "skeleton",
      treeGroups: _treeGroups,
      trees: makeTreesObject(trees),
      activeTreeId: 1,
      activeNodeId: null,
      cachedMaxNodeId: 0,
      activeGroupId: null,
      navigationList: { list: [], activeIndex: -1 },
    },
    volume: null,
  },
});

const allVisible = createState(
  [
    createTree(1, null, true),
    createTree(2, 1, true),
    createTree(3, 2, true),
    createTree(4, 3, true),
    createTree(5, 3, true),
    createTree(6, 4, true),
  ],
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
          enforceSkeletonTracing(prevState.tracing),
          enforceSkeletonTracing(nextState.tracing),
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
    [
      createTree(1, null, true),
      createTree(2, 1, true),
      createTree(3, 2, true),
      createTree(4, 3, false),
      createTree(5, 3, true),
      createTree(6, 4, true),
    ],
    treeGroups,
  );

  const [compactedActions, updateActions] = getActions(allVisible, testState);

  t.deepEqual(compactedActions, updateActions);
});

test("compactUpdateActions should compact when toggling all trees", t => {
  const testState = createState(
    [
      createTree(1, null, false),
      createTree(2, 1, false),
      createTree(3, 2, false),
      createTree(4, 3, false),
      createTree(5, 3, false),
      createTree(6, 4, false),
    ],
    treeGroups,
  );

  const [compactedActions] = getActions(allVisible, testState);

  // Root group should be toggled
  t.deepEqual(compactedActions, [updateTreeGroupVisibility(undefined, false)]);
});

test("compactUpdateActions should compact when toggling a group", t => {
  // Let's toggle group 3 (which contains group 4)
  const testState = createState(
    [
      createTree(1, null, true),
      createTree(2, 1, true),
      createTree(3, 2, true),
      createTree(4, 3, false),
      createTree(5, 3, false),
      createTree(6, 4, false),
    ],
    treeGroups,
  );

  const [compactedActions] = getActions(allVisible, testState);

  t.deepEqual(compactedActions, [updateTreeGroupVisibility(3, false)]);
});

test("compactUpdateActions should compact when toggling a group except for one tree", t => {
  // Let's make all trees invisible except for tree 3. Compaction should yield a toggle-root and toggle 3 action
  const testState = createState(
    [
      createTree(1, null, false),
      createTree(2, 1, false),
      createTree(3, 2, true),
      createTree(4, 3, false),
      createTree(5, 3, false),
      createTree(6, 4, false),
    ],
    treeGroups,
  );

  const [compactedActions] = getActions(allVisible, testState);

  t.deepEqual(compactedActions, [
    updateTreeGroupVisibility(undefined, false),
    _updateTreeVisibility(3, true),
  ]);
});
