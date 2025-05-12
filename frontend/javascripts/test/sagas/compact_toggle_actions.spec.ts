import _ from "lodash";
import { describe, it, expect } from "vitest";
import type { WebknossosState, Tree, TreeGroup, TreeMap } from "viewer/store";
import { diffSkeletonTracing } from "viewer/model/sagas/skeletontracing_saga";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { updateTreeGroupVisibility, updateTreeVisibility } from "viewer/model/sagas/update_actions";
import { withoutUpdateTracing, withoutUpdateTree } from "test/helpers/saveHelpers";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "viewer/model/edge_collection";
import compactToggleActions from "viewer/model/helpers/compaction/compact_toggle_actions";
import defaultState from "viewer/default_state";

const createTree = (id: number, groupId: number | null, isVisible: boolean): Tree => ({
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
  edgesAreVisible: true,
  metadata: [],
  type: "DEFAULT",
});

const makeTreesObject = (trees: Tree[]) => _.keyBy(trees, "treeId") as TreeMap;

const treeGroups: TreeGroup[] = [
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
const tracingId = "someTracingId";
const createState = (trees: Tree[], _treeGroups: TreeGroup[]): WebknossosState => ({
  ...defaultState,
  annotation: {
    ...defaultState.annotation,
    skeleton: {
      additionalAxes: [],
      createdTimestamp: 0,
      tracingId,
      boundingBox: null,
      userBoundingBoxes: [],
      type: "skeleton",
      treeGroups: _treeGroups,
      trees: makeTreesObject(trees),
      activeTreeId: 1,
      activeNodeId: null,
      cachedMaxNodeId: 0,
      activeGroupId: null,
      navigationList: {
        list: [],
        activeIndex: -1,
      },
      showSkeletons: true,
    },
    volumes: [],
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

function testDiffing(prevState: WebknossosState, nextState: WebknossosState) {
  // Let's remove updateTree actions as well, as these will occur here
  // because we don't do shallow updates within the tests (instead, we are
  // are creating completely new trees, so that we don't have to go through the
  // action->reducer pipeline)
  return withoutUpdateTree(
    withoutUpdateTracing(
      Array.from(
        diffSkeletonTracing(
          enforceSkeletonTracing(prevState.annotation),
          enforceSkeletonTracing(nextState.annotation),
        ),
      ),
    ),
  );
}

function _updateTreeVisibility(treeId: number, isVisible: boolean) {
  const tree = {
    treeId,
    isVisible,
  } as any as Tree;
  return updateTreeVisibility(tree, tracingId);
}

function getActions(initialState: WebknossosState, newState: WebknossosState) {
  const updateActions = testDiffing(initialState, newState);

  if (newState.annotation.skeleton == null) {
    // Satisfy typescript
    throw new Error("newState.annotation.skeleton should not be null");
  }

  const compactedActions = compactToggleActions(updateActions, newState.annotation.skeleton);
  return [compactedActions, updateActions];
}

describe("Compact Toggle Actions", () => {
  it("compactUpdateActions shouldn't compact a single action", () => {
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
    expect(compactedActions).toEqual(updateActions);
  });

  it("compactUpdateActions should compact when toggling all trees", () => {
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
    expect(compactedActions).toEqual([updateTreeGroupVisibility(undefined, false, tracingId)]);
  });

  it("compactUpdateActions should compact when toggling a group", () => {
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
    expect(compactedActions).toEqual([updateTreeGroupVisibility(3, false, tracingId)]);
  });

  it("compactUpdateActions should compact when toggling a group except for one tree", () => {
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
    expect(compactedActions).toEqual([
      updateTreeGroupVisibility(undefined, false, tracingId),
      _updateTreeVisibility(3, true),
    ]);
  });
});
