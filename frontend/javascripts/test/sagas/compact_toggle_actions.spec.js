// @noflow

import { updateTreeGroupVisibility, updateTreeVisibility } from "oxalis/model/sagas/update_actions";
import ChainReducer from "test/helpers/chainReducer";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import compactToggleActions from "oxalis/model/helpers/compaction/compact_toggle_actions";
import mockRequire from "mock-require";
import test from "ava";

const SkeletonTracingReducer = mockRequire.reRequire(
  "oxalis/model/reducers/skeletontracing_reducer",
).default;

const createInitialTree = (id, groupId) => ({
  treeId: id,
  name: "TestTree",
  nodes: new DiffableMap(),
  timestamp: 12345678,
  branchPoints: [],
  edges: new EdgeCollection(),
  comments: [],
  color: [23, 23, 23],
  isVisible: true,
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

const initialState = {
  tracing: {
    skeleton: {
      type: "skeleton",
      treeGroups,
      trees: {
        "1": createInitialTree(1, null),
        "2": createInitialTree(2, 1),
        "3": createInitialTree(3, 2),
        "4": createInitialTree(4, 3),
        "5": createInitialTree(5, 3),
        "6": createInitialTree(6, 4),
      },
      activeTreeId: 1,
      activeNodeId: null,
      cachedMaxNodeId: 0,
    },
    volume: null,
  },
};

test("compactUpdateActions shouldn't compact a single action", t => {
  const actions = [updateTreeVisibility({ treeId: 1, isVisible: false })];
  const compactedActions = compactToggleActions(actions, initialState.tracing);

  t.deepEqual(compactedActions, actions);
});

test("compactUpdateActions should compact when toggling all trees", t => {
  const h = id => updateTreeVisibility({ treeId: id, isVisible: false });
  const actions = [h(1), h(2), h(3), h(4), h(5), h(6)];

  const newState = ChainReducer(initialState)
    .applyAll(SkeletonTracingReducer, actions)
    .unpack();

  console.log("newState.tracing.skeleton.trees", newState.tracing.skeleton.trees);

  const compactedActions = compactToggleActions(actions, newState.tracing);

  t.deepEqual(compactedActions, [updateTreeGroupVisibility(undefined, false)]);
});
