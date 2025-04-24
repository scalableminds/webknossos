import _ from "lodash";
import { describe, it, expect } from "vitest";
import type {
  Flycam,
  OxalisState,
  Segment,
  SegmentGroup,
  Tree,
  TreeGroup,
  TreeMap,
} from "oxalis/store";
import { diffSkeletonTracing } from "oxalis/model/sagas/skeletontracing_saga";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  updateSegmentGroupVisibilityVolumeAction,
  updateSegmentVisibilityVolumeAction,
  updateTreeGroupVisibility,
  updateTreeVisibility,
} from "oxalis/model/sagas/update_actions";
import {
  withoutUpdateSegment,
  withoutUpdateTracing,
  withoutUpdateTree,
} from "test/helpers/saveHelpers";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import compactToggleActions from "oxalis/model/helpers/compaction/compact_toggle_actions";
import defaultState from "oxalis/default_state";
import { diffVolumeTracing } from "oxalis/model/sagas/volumetracing_saga";

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

const createSegment = (id: number, groupId: number | null, isVisible: boolean): Segment => ({
  id,
  name: "TestSegment",
  color: [23, 23, 23],
  creationTime: 12345678,
  somePosition: [0, 0, 0],
  isVisible,
  someAdditionalCoordinates: [],
  groupId,
  metadata: [],
});

const makeTreesObject = (trees: Tree[]) => _.keyBy(trees, "treeId") as TreeMap;

const genericGroups: TreeGroup[] = [
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
    name: "subroot2",
    groupId: 2,
    children: [],
  },
];
const flycamMock = {} as any as Flycam;
const tracingId = "someTracingId";
const createStateWithTrees = (trees: Tree[], genericGroups: TreeGroup[]): OxalisState => ({
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
      treeGroups: genericGroups,
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

const createStateWithSegments = (
  segments: Segment[],
  segmentGroups: SegmentGroup[],
): OxalisState => ({
  ...defaultState,
  annotation: {
    ...defaultState.annotation,
    volumes: [
      {
        createdTimestamp: 0,
        userBoundingBoxes: [],
        hasSegmentIndex: false,
        contourTracingMode: "DRAW",
        boundingBox: { min: [0, 0, 0], max: [10, 10, 10] },
        additionalAxes: [],
        type: "volume",
        activeCellId: 1,
        largestSegmentId: 0,
        contourList: [],
        lastLabelActions: [],
        tracingId,
        segmentGroups,
        segments: new DiffableMap(segments.map((s) => [s.id, s])),
      },
    ],
  },
});

const allVisibleTrees = createStateWithTrees(
  [
    createTree(1, null, true),
    createTree(2, 1, true),
    createTree(3, 2, true),
    createTree(4, 3, true),
    createTree(5, 3, true),
    createTree(6, 4, true),
  ],
  genericGroups,
);

const allVisibleSegments = createStateWithSegments(
  [
    createSegment(1, null, true),
    createSegment(2, 1, true),
    createSegment(3, 2, true),
    createSegment(4, 3, true),
    createSegment(5, 3, true),
    createSegment(6, 4, true),
  ],
  genericGroups,
);

function testSkeletonDiffing(prevState: OxalisState, nextState: OxalisState) {
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
          flycamMock,
          flycamMock,
        ),
      ),
    ),
  );
}

function testVolumeDiffing(prevState: OxalisState, nextState: OxalisState) {
  // Let's remove updateTree actions as well, as these will occur here
  // because we don't do shallow updates within the tests (instead, we are
  // are creating completely new trees, so that we don't have to go through the
  // action->reducer pipeline)
  return withoutUpdateSegment(
    withoutUpdateTracing(
      Array.from(
        diffVolumeTracing(
          prevState.annotation.volumes[0],
          nextState.annotation.volumes[0],
          flycamMock,
          flycamMock,
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

function getSkeletonActions(initialState: OxalisState, newState: OxalisState) {
  const updateActions = testSkeletonDiffing(initialState, newState);

  if (newState.annotation.skeleton == null) {
    // Satisfy typescript
    throw new Error("newState.annotation.skeleton should not be null");
  }

  const compactedActions = compactToggleActions(updateActions, newState.annotation.skeleton);
  return [compactedActions, updateActions];
}

function getVolumeActions(initialState: OxalisState, newState: OxalisState) {
  const updateActions = testVolumeDiffing(initialState, newState);

  const compactedActions = compactToggleActions(updateActions, newState.annotation.volumes[0]);
  return [compactedActions, updateActions];
}

describe("Compact Toggle Actions for skeletons", () => {
  it("compactUpdateActions shouldn't compact a single action", () => {
    const testState = createStateWithTrees(
      [
        createTree(1, null, true),
        createTree(2, 1, true),
        createTree(3, 2, true),
        createTree(4, 3, false),
        createTree(5, 3, true),
        createTree(6, 4, true),
      ],
      genericGroups,
    );
    const [compactedActions, updateActions] = getSkeletonActions(allVisibleTrees, testState);
    expect(compactedActions).toEqual(updateActions);
  });

  it("compactUpdateActions should compact when toggling all trees", () => {
    const testState = createStateWithTrees(
      [
        createTree(1, null, false),
        createTree(2, 1, false),
        createTree(3, 2, false),
        createTree(4, 3, false),
        createTree(5, 3, false),
        createTree(6, 4, false),
      ],
      genericGroups,
    );
    const [compactedActions] = getSkeletonActions(allVisibleTrees, testState);
    // Root group should be toggled
    expect(compactedActions).toEqual([updateTreeGroupVisibility(undefined, false, tracingId)]);
  });

  it("compactUpdateActions should compact when toggling a group", () => {
    // Let's toggle group 3 (which contains group 4)
    const testState = createStateWithTrees(
      [
        createTree(1, null, true),
        createTree(2, 1, true),
        createTree(3, 2, true),
        createTree(4, 3, false),
        createTree(5, 3, false),
        createTree(6, 4, false),
      ],
      genericGroups,
    );
    const [compactedActions] = getSkeletonActions(allVisibleTrees, testState);
    expect(compactedActions).toEqual([updateTreeGroupVisibility(3, false, tracingId)]);
  });

  it("compactUpdateActions should compact when toggling a group except for one tree", () => {
    // Let's make all trees invisible except for tree 3. Compaction should yield a toggle-root and toggle 3 action
    const testState = createStateWithTrees(
      [
        createTree(1, null, false),
        createTree(2, 1, false),
        createTree(3, 2, true),
        createTree(4, 3, false),
        createTree(5, 3, false),
        createTree(6, 4, false),
      ],
      genericGroups,
    );
    const [compactedActions] = getSkeletonActions(allVisibleTrees, testState);
    expect(compactedActions).toEqual([
      updateTreeGroupVisibility(undefined, false, tracingId),
      _updateTreeVisibility(3, true),
    ]);
  });
});

describe("Compact Toggle Actions for volume tracings", () => {
  it("compactUpdateActions shouldn't compact a single action", () => {
    const testState = createStateWithSegments(
      [
        createSegment(1, null, true),
        createSegment(2, 1, true),
        createSegment(3, 2, true),
        createSegment(4, 3, false),
        createSegment(5, 3, true),
        createSegment(6, 4, true),
      ],
      genericGroups,
    );
    const [compactedActions, updateActions] = getVolumeActions(allVisibleSegments, testState);
    expect(compactedActions).toEqual(updateActions);
  });

  it("compactUpdateActions should compact when toggling all trees", () => {
    const testState = createStateWithSegments(
      [
        createSegment(1, null, false),
        createSegment(2, 1, false),
        createSegment(3, 2, false),
        createSegment(4, 3, false),
        createSegment(5, 3, false),
        createSegment(6, 4, false),
      ],
      genericGroups,
    );
    const [compactedActions] = getVolumeActions(allVisibleSegments, testState);
    // Root group should be toggled
    expect(compactedActions).toEqual([
      updateSegmentGroupVisibilityVolumeAction(null, false, tracingId),
    ]);
  });

  it("compactUpdateActions should compact when toggling a group", () => {
    // Let's toggle group 3 (which contains group 4)
    const testState = createStateWithSegments(
      [
        createSegment(1, null, true),
        createSegment(2, 1, true),
        createSegment(3, 2, true),
        createSegment(4, 3, false),
        createSegment(5, 3, false),
        createSegment(6, 4, false),
      ],
      genericGroups,
    );
    const [compactedActions] = getVolumeActions(allVisibleSegments, testState);
    expect(compactedActions).toEqual([
      updateSegmentGroupVisibilityVolumeAction(3, false, tracingId),
    ]);
  });

  it("compactUpdateActions should compact when toggling a group except for one tree", () => {
    // Let's make all trees invisible except for tree 3. Compaction should yield a toggle-root and toggle 3 action
    const testState = createStateWithSegments(
      [
        createSegment(1, null, false),
        createSegment(2, 1, false),
        createSegment(3, 2, true),
        createSegment(4, 3, false),
        createSegment(5, 3, false),
        createSegment(6, 4, false),
      ],
      genericGroups,
    );
    const [compactedActions] = getVolumeActions(allVisibleSegments, testState);
    expect(compactedActions).toEqual([
      updateSegmentGroupVisibilityVolumeAction(null, false, tracingId),
      updateSegmentVisibilityVolumeAction(3, true, tracingId),
    ]);
  });
});
