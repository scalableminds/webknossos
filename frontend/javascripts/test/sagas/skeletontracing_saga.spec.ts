import "test/sagas/skeletontracing_saga.mock.js";
import type { Flycam, HybridTracing, OxalisState, SkeletonTracing } from "oxalis/store";
import ChainReducer from "test/helpers/chainReducer";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import compactSaveQueue from "oxalis/model/helpers/compaction/compact_save_queue";
import compactUpdateActions from "oxalis/model/helpers/compaction/compact_update_actions";
import mockRequire from "mock-require";
import test from "ava";
import defaultState from "oxalis/default_state";
import update from "immutability-helper";
import { createSaveQueueFromUpdateActions, withoutUpdateTracing } from "../helpers/saveHelpers";
import { expectValueDeepEqual, execCall } from "../helpers/sagaHelpers";
import { MISSING_GROUP_ID } from "oxalis/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import type * as OriginalSkeletonTracingActions from "oxalis/model/actions/skeletontracing_actions";
import type * as OriginalSaveActions from "oxalis/model/actions/save_actions";
import type * as OriginalSaveSaga from "oxalis/model/sagas/save_saga";
import type * as OriginalSkeletonTracingSaga from "oxalis/model/sagas/skeletontracing_saga";
import type OriginalSkeletonTracingReducer from "oxalis/model/reducers/skeletontracing_reducer";
import { TreeTypeEnum } from "oxalis/constants";
import type { Action } from "oxalis/model/actions/actions";
import type { ServerSkeletonTracing } from "types/api_flow_types";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import type { UpdateActionWithoutIsolationRequirement } from "oxalis/model/sagas/update_actions";
import type { TracingStats } from "oxalis/model/accessors/annotation_accessor";

const TIMESTAMP = 1494347146379;
const actionTracingId = "tracingId";
const DateMock = {
  now: () => TIMESTAMP,
};
mockRequire("libs/date", DateMock);
mockRequire("oxalis/model/sagas/root_saga", function* () {
  yield;
});
const { diffSkeletonTracing }: typeof OriginalSkeletonTracingSaga = mockRequire.reRequire(
  "oxalis/model/sagas/skeletontracing_saga",
);
const { setupSavingForTracingType }: typeof OriginalSaveSaga = mockRequire.reRequire(
  "oxalis/model/sagas/save_saga",
);
const SkeletonTracingActions: typeof OriginalSkeletonTracingActions = mockRequire.reRequire(
  "oxalis/model/actions/skeletontracing_actions",
);
const { pushSaveQueueTransaction }: typeof OriginalSaveActions = mockRequire.reRequire(
  "oxalis/model/actions/save_actions",
);
const SkeletonTracingReducer: typeof OriginalSkeletonTracingReducer = mockRequire.reRequire(
  "oxalis/model/reducers/skeletontracing_reducer",
).default;
const { put } = mockRequire.reRequire("redux-saga/effects");

function testDiffing(
  prevTracing: HybridTracing,
  nextTracing: HybridTracing,
  prevFlycam: Flycam,
  flycam: Flycam,
) {
  return withoutUpdateTracing(
    Array.from(
      diffSkeletonTracing(
        enforceSkeletonTracing(prevTracing),
        enforceSkeletonTracing(nextTracing),
        prevFlycam,
        flycam,
      ),
    ),
  );
}

function createCompactedSaveQueueFromUpdateActions(
  updateActions: UpdateActionWithoutIsolationRequirement[][],
  timestamp: number,
  tracing: SkeletonTracing,
  stats: TracingStats | null = null,
) {
  return compactSaveQueue(
    createSaveQueueFromUpdateActions(
      updateActions.map((batch) => compactUpdateActions(batch, tracing)),
      timestamp,
      stats,
    ),
  );
}

const skeletonTracing: SkeletonTracing = {
  type: "skeleton",
  createdTimestamp: 0,
  tracingId: "tracingId",
  trees: {},
  treeGroups: [],
  activeGroupId: null,
  activeTreeId: 1,
  activeNodeId: null,
  cachedMaxNodeId: 0,
  boundingBox: null,
  userBoundingBoxes: [],
  navigationList: {
    list: [],
    activeIndex: -1,
  },
  showSkeletons: true,
  additionalAxes: [],
};

const serverSkeletonTracing: ServerSkeletonTracing = {
  ...skeletonTracing,
  id: skeletonTracing.tracingId,
  editPosition: {
    x: 0,
    y: 0,
    z: 0,
  },
  editPositionAdditionalCoordinates: null,
  editRotation: {
    x: 0,
    y: 0,
    z: 0,
  },
  additionalAxes: [],
  zoomLevel: 2,
  userBoundingBoxes: [],
  typ: "Skeleton",
  activeNodeId: undefined,
  boundingBox: undefined,
  trees: [],
};
skeletonTracing.trees[1] = {
  treeId: 1,
  name: "TestTree",
  nodes: new DiffableMap(),
  timestamp: 12345678,
  branchPoints: [],
  edges: new EdgeCollection(),
  comments: [],
  color: [23, 23, 23],
  isVisible: true,
  groupId: MISSING_GROUP_ID,
  type: TreeTypeEnum.DEFAULT,
  edgesAreVisible: true,
  metadata: [],
};
const initialState = update(defaultState, {
  tracing: {
    restrictions: {
      allowUpdate: {
        $set: true,
      },
      branchPointsAllowed: {
        $set: true,
      },
    },
    skeleton: {
      $set: skeletonTracing,
    },
  },
});

const createNodeAction = SkeletonTracingActions.createNodeAction(
  [1, 2, 3],
  null,
  [0, 1, 0],
  0,
  1.2,
);
const deleteNodeAction = SkeletonTracingActions.deleteNodeAction();
const createTreeAction = SkeletonTracingActions.createTreeAction(undefined, 12345678);
const deleteTreeAction = SkeletonTracingActions.deleteTreeAction();
const setNodeRadiusAction = SkeletonTracingActions.setNodeRadiusAction(12);
const createCommentAction = SkeletonTracingActions.createCommentAction("Hallo");
const createBranchPointAction = SkeletonTracingActions.createBranchPointAction(
  undefined,
  undefined,
  12345678,
);
test("SkeletonTracingSaga shouldn't do anything if unchanged (saga test)", (t) => {
  const saga = setupSavingForTracingType(
    SkeletonTracingActions.initializeSkeletonTracingAction(serverSkeletonTracing),
  );

  saga.next();
  saga.next(initialState.tracing.skeleton);
  saga.next(initialState.flycam);
  saga.next(initialState.viewModeData.plane.tdCamera);
  saga.next();
  saga.next();
  saga.next(true);
  saga.next(initialState.tracing.skeleton);
  saga.next(initialState.flycam);
  // only updateTracing
  const items = execCall(t, saga.next(initialState.viewModeData.plane.tdCamera));
  t.is(withoutUpdateTracing(items).length, 0);
});
test("SkeletonTracingSaga should do something if changed (saga test)", (t) => {
  const newState = SkeletonTracingReducer(initialState, createNodeAction);
  const saga = setupSavingForTracingType(
    SkeletonTracingActions.initializeSkeletonTracingAction(serverSkeletonTracing),
  );

  saga.next();
  saga.next(initialState.tracing.skeleton);
  saga.next(initialState.flycam);
  saga.next(initialState.viewModeData.plane.tdCamera);
  saga.next();
  saga.next();
  saga.next(true);
  saga.next(newState.tracing.skeleton);
  saga.next(newState.flycam);
  const items = execCall(t, saga.next(newState.viewModeData.plane.tdCamera));
  t.true(withoutUpdateTracing(items).length > 0);
  expectValueDeepEqual(t, saga.next(items), put(pushSaveQueueTransaction(items)));
});
test("SkeletonTracingSaga should emit createNode update actions", (t) => {
  const newState = SkeletonTracingReducer(initialState, createNodeAction);
  const updateActions = testDiffing(
    initialState.tracing,
    newState.tracing,
    initialState.flycam,
    newState.flycam,
  );
  t.like(updateActions[0], {
    name: "createNode",
    value: {
      id: 1,
      treeId: 1,
    },
  });
});
test("SkeletonTracingSaga should emit createNode and createEdge update actions", (t) => {
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const updateActions = testDiffing(
    initialState.tracing,
    newState.tracing,
    initialState.flycam,
    newState.flycam,
  );
  t.like(updateActions[0], {
    name: "createNode",
    value: {
      actionTracingId,
      id: 1,
      treeId: 1,
    },
  });
  t.like(updateActions[1], {
    name: "createNode",
    value: {
      actionTracingId,
      id: 2,
      treeId: 1,
    },
  });
  t.deepEqual(updateActions[2], {
    name: "createEdge",
    value: {
      actionTracingId,
      treeId: 1,
      source: 1,
      target: 2,
    },
  });
});
test("SkeletonTracingSaga should emit createNode and createTree update actions", (t) => {
  const newState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const updateActions = testDiffing(
    initialState.tracing,
    newState.tracing,
    initialState.flycam,
    newState.flycam,
  );
  t.like(updateActions[0], {
    name: "createTree",
    value: {
      actionTracingId,
      id: 2,
    },
  });
  t.like(updateActions[1], {
    name: "createNode",
    value: {
      actionTracingId,
      id: 2,
      treeId: 2,
    },
  });
  t.like(updateActions[2], {
    name: "createNode",
    value: {
      actionTracingId,
      id: 1,
      treeId: 1,
    },
  });
});
test("SkeletonTracingSaga should emit first deleteNode and then createNode update actions", (t) => {
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 2);
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, mergeTreesAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  t.deepEqual(updateActions[0], {
    name: "deleteNode",
    value: {
      actionTracingId,
      nodeId: 2,
      treeId: 2,
    },
  });
  t.deepEqual(updateActions[1], {
    name: "deleteTree",
    value: {
      actionTracingId,
      id: 2,
    },
  });
  t.like(updateActions[2], {
    name: "createNode",
    value: {
      actionTracingId,
      id: 2,
      treeId: 1,
    },
  });
  t.deepEqual(updateActions[3], {
    name: "createEdge",
    value: {
      actionTracingId,
      treeId: 1,
      source: 1,
      target: 2,
    },
  });
});
test("SkeletonTracingSaga should emit a deleteNode update action", (t) => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, deleteNodeAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  t.deepEqual(updateActions[0], {
    name: "deleteNode",
    value: {
      actionTracingId,
      nodeId: 1,
      treeId: 1,
    },
  });
});
test("SkeletonTracingSaga should emit a deleteEdge update action", (t) => {
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, deleteNodeAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  t.deepEqual(updateActions[0], {
    name: "deleteNode",
    value: {
      actionTracingId,
      nodeId: 2,
      treeId: 1,
    },
  });
  t.deepEqual(updateActions[1], {
    name: "deleteEdge",
    value: {
      actionTracingId,
      treeId: 1,
      source: 1,
      target: 2,
    },
  });
});
test("SkeletonTracingSaga should emit a deleteTree update action", (t) => {
  const testState = SkeletonTracingReducer(initialState, createTreeAction);
  const newState = SkeletonTracingReducer(testState, deleteTreeAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  t.like(updateActions[0], {
    name: "deleteTree",
    value: {
      actionTracingId,
      id: 2,
    },
  });
});
test("SkeletonTracingSaga should emit an updateNode update action", (t) => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, setNodeRadiusAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  t.like(updateActions[0], {
    name: "updateNode",
    value: {
      actionTracingId,
      id: 1,
      treeId: 1,
      radius: 12,
    },
  });
});
test("SkeletonTracingSaga should emit an updateNode update action 2", (t) => {
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, setNodeRadiusAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, setNodeRadiusAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  t.deepEqual(updateActions, []);
});
test("SkeletonTracingSaga should emit an updateTree update actions (comments)", (t) => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, createCommentAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  t.like(updateActions[0], {
    name: "updateTree",
    value: {
      actionTracingId,
      id: 1,
      comments: [
        {
          nodeId: 1,
          content: "Hallo",
        },
      ],
    },
  });
});
test("SkeletonTracingSaga shouldn't emit an updateTree update actions (comments)", (t) => {
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createCommentAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, createCommentAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  t.deepEqual(updateActions, []);
});
test("SkeletonTracingSaga should emit an updateTree update actions (branchpoints)", (t) => {
  const testState = SkeletonTracingReducer(initialState, createNodeAction);
  const newState = SkeletonTracingReducer(testState, createBranchPointAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  t.like(updateActions[0], {
    name: "updateTree",
    value: {
      actionTracingId,
      id: 1,
      branchPoints: [
        {
          nodeId: 1,
          timestamp: 12345678,
        },
      ],
    },
  });
});
test("SkeletonTracingSaga should emit update actions on merge tree", (t) => {
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(3, 1);
  // create a node in first tree, then create a second tree with three nodes and merge them
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, mergeTreesAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  t.deepEqual(updateActions[0], {
    name: "deleteNode",
    value: {
      actionTracingId,
      treeId: 1,
      nodeId: 1,
    },
  });
  t.deepEqual(updateActions[1], {
    name: "deleteTree",
    value: {
      actionTracingId,
      id: 1,
    },
  });
  t.like(updateActions[2], {
    name: "createNode",
    value: {
      actionTracingId,
      id: 1,
      treeId: 2,
    },
  });
  t.deepEqual(updateActions[3], {
    name: "createEdge",
    value: {
      actionTracingId,
      treeId: 2,
      source: 3,
      target: 1,
    },
  });
});
test("SkeletonTracingSaga should emit update actions on split tree", (t) => {
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(3, 1);
  // create a node in first tree, then create a second tree with three nodes and merge them
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, mergeTreesAction)
    .unpack();
  // Node 3 will be deleted since it is active in testState.
  const newState = SkeletonTracingReducer(testState, deleteNodeAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  t.like(updateActions[0], {
    name: "createTree",
    value: {
      actionTracingId,
      id: 3,
    },
  });
  t.like(updateActions[1], {
    name: "createNode",
    value: {
      actionTracingId,
      id: 2,
      treeId: 3,
    },
  });
  t.like(updateActions[2], {
    name: "createTree",
    value: {
      actionTracingId,
      id: 4,
    },
  });
  t.like(updateActions[3], {
    name: "createNode",
    value: {
      actionTracingId,
      id: 4,
      treeId: 4,
    },
  });
  t.deepEqual(updateActions[4], {
    name: "deleteNode",
    value: {
      actionTracingId,
      treeId: 2,
      nodeId: 2,
    },
  });
  t.deepEqual(updateActions[5], {
    name: "deleteNode",
    value: {
      actionTracingId,
      treeId: 2,
      nodeId: 3,
    },
  });
  t.deepEqual(updateActions[6], {
    name: "deleteNode",
    value: {
      actionTracingId,
      treeId: 2,
      nodeId: 4,
    },
  });
  t.deepEqual(updateActions[7], {
    name: "deleteEdge",
    value: {
      actionTracingId,
      treeId: 2,
      source: 2,
      target: 3,
    },
  });
  t.deepEqual(updateActions[8], {
    name: "deleteEdge",
    value: {
      actionTracingId,
      treeId: 2,
      source: 3,
      target: 4,
    },
  });
  t.deepEqual(updateActions[9], {
    name: "deleteEdge",
    value: {
      actionTracingId,
      treeId: 2,
      source: 3,
      target: 1,
    },
  });
});
test("compactUpdateActions should detect a tree merge (1/3)", (t) => {
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(4, 1);
  // Create three nodes in the first tree, then create a second tree with one node and merge them
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  const newState = SkeletonTracingReducer(testState, mergeTreesAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
    [updateActions],
    TIMESTAMP,
    skeletonTracing,
  );

  const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
  // This should result in a moved treeComponent of size three
  t.deepEqual(simplifiedFirstBatch[0], {
    name: "moveTreeComponent",
    value: {
      actionTracingId,
      sourceId: 1,
      targetId: 2,
      nodeIds: [1, 2, 3],
    },
  });
  // the deletion of the merged tree
  t.deepEqual(simplifiedFirstBatch[1], {
    name: "deleteTree",
    value: {
      actionTracingId,
      id: 1,
    },
  });
  // and a new edge to connect the two trees
  t.deepEqual(simplifiedFirstBatch[2], {
    name: "createEdge",
    value: {
      actionTracingId,
      treeId: 2,
      source: 4,
      target: 1,
    },
  });
  t.is(simplifiedFirstBatch.length, 3);
});
test("compactUpdateActions should detect a tree merge (2/3)", (t) => {
  // In this test multiple diffs are performed and concatenated before compactUpdateActions is invoked
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(5, 1);
  // Create three nodes in the first tree, then create a second tree with one node
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  // Create another node (a)
  const newState1 = SkeletonTracingReducer(testState, createNodeAction);
  const updateActions = [];
  updateActions.push(
    testDiffing(testState.tracing, newState1.tracing, testState.flycam, newState1.flycam),
  );
  // Merge the two trees (b), then create another tree and node (c)
  const newState2 = ChainReducer<OxalisState, Action>(newState1)
    .apply(SkeletonTracingReducer, mergeTreesAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  updateActions.push(
    testDiffing(newState1.tracing, newState2.tracing, newState1.flycam, newState2.flycam),
  );
  // compactUpdateActions is triggered by the saving, it can therefore contain the results of more than one diffing
  const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
    updateActions,
    TIMESTAMP,
    skeletonTracing,
  );

  // This should result in one created node and its edge (a)
  const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
  t.like(simplifiedFirstBatch[0], {
    name: "createNode",
    value: {
      actionTracingId,
      id: 5,
      treeId: 2,
    },
  });
  t.like(simplifiedFirstBatch[1], {
    name: "createEdge",
    value: {
      actionTracingId,
      treeId: 2,
      source: 4,
      target: 5,
    },
  });
  t.is(simplifiedFirstBatch.length, 2);
  const simplifiedSecondBatch = simplifiedUpdateActions[1].actions;
  // a moved tree component of size three (b)
  t.deepEqual(simplifiedSecondBatch[0], {
    name: "moveTreeComponent",
    value: {
      actionTracingId,
      sourceId: 1,
      targetId: 2,
      nodeIds: [1, 2, 3],
    },
  });
  // the deletion of the merged tree (b)
  t.deepEqual(simplifiedSecondBatch[1], {
    name: "deleteTree",
    value: {
      actionTracingId,
      id: 1,
    },
  });
  // the creation of a new tree and node (c)
  t.is(simplifiedSecondBatch[2].name, "createTree");
  t.is(simplifiedSecondBatch[3].name, "createNode");
  // a new edge to connect the two trees (b)
  t.deepEqual(simplifiedSecondBatch[4], {
    name: "createEdge",
    value: {
      actionTracingId,
      treeId: 2,
      source: 5,
      target: 1,
    },
  });
  t.is(simplifiedSecondBatch.length, 5);
});
test("compactUpdateActions should detect a tree merge (3/3)", (t) => {
  // In this test multiple merges and diffs are performed and concatenated before compactUpdateActions is invoked
  const firstMergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 4);
  const secondMergeTreesAction = SkeletonTracingActions.mergeTreesAction(1, 6);
  // Create three nodes in the first tree, then create a second tree with one node
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  // Merge the second tree into the first tree (a)
  const stateAfterFirstMerge = SkeletonTracingReducer(testState, firstMergeTreesAction);
  const updateActions = [];
  updateActions.push(
    testDiffing(
      testState.tracing,
      stateAfterFirstMerge.tracing,
      testState.flycam,
      stateAfterFirstMerge.flycam,
    ),
  );
  // Create another tree and two nodes (b)
  const newState = ChainReducer<OxalisState, Action>(stateAfterFirstMerge)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  updateActions.push(
    testDiffing(
      stateAfterFirstMerge.tracing,
      newState.tracing,
      stateAfterFirstMerge.flycam,
      newState.flycam,
    ),
  );
  // Merge the second tree into the first tree again (c)
  const stateAfterSecondMerge = SkeletonTracingReducer(newState, secondMergeTreesAction);
  updateActions.push(
    testDiffing(
      newState.tracing,
      stateAfterSecondMerge.tracing,
      newState.flycam,
      stateAfterSecondMerge.flycam,
    ),
  );
  // compactUpdateActions is triggered by the saving, it can therefore contain the results of more than one diffing
  const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
    updateActions,
    TIMESTAMP,
    skeletonTracing,
  );
  // This should result in a moved treeComponent of size one (a)
  const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
  t.deepEqual(simplifiedFirstBatch[0], {
    name: "moveTreeComponent",
    value: {
      actionTracingId,
      sourceId: 2,
      targetId: 1,
      nodeIds: [4],
    },
  });
  // the deletion of the first merged tree (a)
  t.deepEqual(simplifiedFirstBatch[1], {
    name: "deleteTree",
    value: {
      actionTracingId,
      id: 2,
    },
  });
  // the creation of an edge two connect the first two trees (a)
  t.deepEqual(simplifiedFirstBatch[2], {
    name: "createEdge",
    value: {
      actionTracingId,
      treeId: 1,
      source: 1,
      target: 4,
    },
  });
  t.is(simplifiedFirstBatch.length, 3);
  // the creation of another tree, two nodes and one edge (b)
  const simplifiedSecondBatch = simplifiedUpdateActions[1].actions;
  t.is(simplifiedSecondBatch[0].name, "createTree");
  t.is(simplifiedSecondBatch[1].name, "createNode");
  t.is(simplifiedSecondBatch[2].name, "createNode");
  t.is(simplifiedSecondBatch[3].name, "createEdge");
  t.is(simplifiedSecondBatch.length, 4);
  // a second merge (c)
  const simplifiedThirdBatch = simplifiedUpdateActions[2].actions;
  t.deepEqual(simplifiedThirdBatch[0], {
    name: "moveTreeComponent",
    value: {
      actionTracingId,
      sourceId: 2,
      targetId: 1,
      nodeIds: [5, 6],
    },
  });
  t.deepEqual(simplifiedThirdBatch[1], {
    name: "deleteTree",
    value: {
      actionTracingId,
      id: 2,
    },
  });
  t.deepEqual(simplifiedThirdBatch[2], {
    name: "createEdge",
    value: {
      actionTracingId,
      treeId: 1,
      source: 1,
      target: 6,
    },
  });
  t.is(simplifiedThirdBatch.length, 3);
});
test("compactUpdateActions should detect a tree split (1/3)", (t) => {
  const deleteMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(2);
  // Create four nodes
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  // Delete the second node to split the tree
  const newState = SkeletonTracingReducer(testState, deleteMiddleNodeAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );

  const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
    [updateActions],
    TIMESTAMP,
    skeletonTracing,
  );

  // This should result in a new tree
  const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
  t.like(simplifiedFirstBatch[0], {
    name: "createTree",
    value: {
      actionTracingId,
      id: 2,
    },
  });
  // a treeComponent of size two that is moved to the new tree
  t.deepEqual(simplifiedFirstBatch[1], {
    name: "moveTreeComponent",
    value: {
      actionTracingId,
      sourceId: 1,
      targetId: 2,
      nodeIds: [3, 4],
    },
  });
  // the deletion of the node and its two edges
  t.deepEqual(simplifiedFirstBatch[2], {
    name: "deleteNode",
    value: {
      actionTracingId,
      nodeId: 2,
      treeId: 1,
    },
  });
  t.is(simplifiedFirstBatch[3].name, "deleteEdge");
  t.is(simplifiedFirstBatch[4].name, "deleteEdge");
  t.is(simplifiedFirstBatch.length, 5);
});
test("compactUpdateActions should detect a tree split (2/3)", (t) => {
  // Branchpoint tree split
  const deleteMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(2);
  const setActiveNodeAction = SkeletonTracingActions.setActiveNodeAction(2);
  // Create four nodes, then set node 2 as active and create another three nodes
  // Node 2 now has three neighbors
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, setActiveNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  // Delete node 2 to split the tree into three parts
  const newState = SkeletonTracingReducer(testState, deleteMiddleNodeAction);
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
    [updateActions],
    TIMESTAMP,
    skeletonTracing,
  );
  // This should result in two new trees and two moved treeComponents of size three and two
  const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
  t.like(simplifiedFirstBatch[0], {
    name: "createTree",
    value: {
      actionTracingId,
      id: 2,
    },
  });
  t.deepEqual(simplifiedFirstBatch[1], {
    name: "moveTreeComponent",
    value: {
      actionTracingId,
      sourceId: 1,
      targetId: 2,
      nodeIds: [3, 4],
    },
  });
  t.like(simplifiedFirstBatch[2], {
    name: "createTree",
    value: {
      actionTracingId,
      id: 3,
    },
  });
  t.deepEqual(simplifiedFirstBatch[3], {
    name: "moveTreeComponent",
    value: {
      actionTracingId,
      sourceId: 1,
      targetId: 3,
      nodeIds: [5, 6, 7],
    },
  });
  // the deletion of the node and its three edges
  t.deepEqual(simplifiedFirstBatch[4], {
    name: "deleteNode",
    value: {
      actionTracingId,
      nodeId: 2,
      treeId: 1,
    },
  });
  t.is(simplifiedFirstBatch[5].name, "deleteEdge");
  t.is(simplifiedFirstBatch[6].name, "deleteEdge");
  t.is(simplifiedFirstBatch[7].name, "deleteEdge");
  t.is(simplifiedFirstBatch.length, 8);
});
test("compactUpdateActions should detect a tree split (3/3)", (t) => {
  // Detect multiple tree splits
  const deleteMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(2);
  const deleteOtherMiddleNodeAction = SkeletonTracingActions.deleteNodeAction(4);
  // Create six nodes
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  // Delete the second node to split the tree (a)
  const newState1 = SkeletonTracingReducer(testState, deleteMiddleNodeAction);
  const updateActions = [];
  updateActions.push(
    testDiffing(testState.tracing, newState1.tracing, testState.flycam, newState1.flycam),
  );
  // Delete node 4 to split the tree again (b)
  const newState2 = SkeletonTracingReducer(newState1, deleteOtherMiddleNodeAction);
  updateActions.push(
    testDiffing(newState1.tracing, newState2.tracing, newState1.flycam, newState2.flycam),
  );
  const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
    updateActions,
    TIMESTAMP,
    skeletonTracing,
  );
  // This should result in the creation of a new tree (a)
  const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
  t.like(simplifiedFirstBatch[0], {
    name: "createTree",
    value: {
      actionTracingId,
      id: 2,
    },
  });
  // a treeComponent of size four that is moved to the new tree (a)
  t.deepEqual(simplifiedFirstBatch[1], {
    name: "moveTreeComponent",
    value: {
      actionTracingId,
      sourceId: 1,
      targetId: 2,
      nodeIds: [3, 4, 5, 6],
    },
  });
  // and the deletion of the node and its two edges (a)
  t.deepEqual(simplifiedFirstBatch[2], {
    name: "deleteNode",
    value: {
      actionTracingId,
      nodeId: 2,
      treeId: 1,
    },
  });
  t.is(simplifiedFirstBatch[3].name, "deleteEdge");
  t.is(simplifiedFirstBatch[4].name, "deleteEdge");
  t.is(simplifiedFirstBatch.length, 5);
  // the creation of a new tree (b)
  const simplifiedSecondBatch = simplifiedUpdateActions[1].actions;
  t.like(simplifiedSecondBatch[0], {
    name: "createTree",
    value: {
      actionTracingId,
      id: 3,
    },
  });
  // a treeComponent of size two that is moved to the new tree (b)
  t.deepEqual(simplifiedSecondBatch[1], {
    name: "moveTreeComponent",
    value: {
      actionTracingId,
      sourceId: 2,
      targetId: 3,
      nodeIds: [5, 6],
    },
  });
  // and the deletion of the node and its two edges (b)
  t.deepEqual(simplifiedSecondBatch[2], {
    name: "deleteNode",
    value: {
      actionTracingId,
      nodeId: 4,
      treeId: 2,
    },
  });
  t.is(simplifiedSecondBatch[3].name, "deleteEdge");
  t.is(simplifiedSecondBatch[4].name, "deleteEdge");
  t.is(simplifiedSecondBatch.length, 5);
});
test("compactUpdateActions should do nothing if it cannot compact", (t) => {
  // The moveTreeComponent update action moves a list of nodeIds from and oldTreeId to a newTreeId
  // If the tree with the oldTreeId is deleted and the tree with the newTreeId is created
  // in the same diff, compactUpdateActions cannot insert the moveTreeComponent update action at
  // the right spot (see code comments for why)
  // This case cannot happen currently as there is no action in webknossos that results in such a diff,
  // it could however exist in the future and this test makes sure things won't break then
  const mergeTreesAction = SkeletonTracingActions.mergeTreesAction(2, 1);
  // Create three nodes in the first tree, then create a second tree with one node and merge them
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  // Create the tree that is merged to and merge the trees at the same time
  const newState = ChainReducer<OxalisState, Action>(testState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, mergeTreesAction)
    .unpack();
  // This will currently never be the result of one diff (see description of the test)
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  const saveQueueOriginal = createSaveQueueFromUpdateActions([updateActions], TIMESTAMP);
  const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
    [updateActions],
    TIMESTAMP,
    skeletonTracing,
  );
  // The deleteTree optimization in compactUpdateActions (that is unrelated to this test)
  // will remove the first deleteNode update action as the first tree is deleted because of the merge,
  // therefore remove it here as well
  saveQueueOriginal[0].actions.shift();
  // Nothing should be changed as the moveTreeComponent update action cannot be inserted
  t.deepEqual(simplifiedUpdateActions, saveQueueOriginal);
});
test("compactUpdateActions should detect a deleted tree", (t) => {
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  // Delete the tree
  const newState = ChainReducer<OxalisState, Action>(testState)
    .apply(SkeletonTracingReducer, deleteTreeAction)
    .unpack();
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
    [updateActions],
    TIMESTAMP,
    skeletonTracing,
  );
  const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
  t.deepEqual(simplifiedFirstBatch[0], {
    name: "deleteTree",
    value: {
      actionTracingId,
      id: 2,
    },
  });
  t.is(simplifiedFirstBatch.length, 1);
});
test("compactUpdateActions should not detect a deleted tree if there is no deleted tree", (t) => {
  const testState = ChainReducer<OxalisState, Action>(initialState)
    .apply(SkeletonTracingReducer, createTreeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .apply(SkeletonTracingReducer, createNodeAction)
    .unpack();
  // Delete almost all nodes from the tree
  const newState = ChainReducer<OxalisState, Action>(testState)
    .apply(SkeletonTracingReducer, deleteNodeAction)
    .apply(SkeletonTracingReducer, deleteNodeAction)
    .unpack();
  const updateActions = testDiffing(
    testState.tracing,
    newState.tracing,
    testState.flycam,
    newState.flycam,
  );
  const simplifiedUpdateActions = createCompactedSaveQueueFromUpdateActions(
    [updateActions],
    TIMESTAMP,
    skeletonTracing,
  );
  const simplifiedFirstBatch = simplifiedUpdateActions[0].actions;
  t.deepEqual(simplifiedFirstBatch[0], {
    name: "deleteNode",
    value: {
      actionTracingId,
      nodeId: 2,
      treeId: 2,
    },
  });
  t.deepEqual(simplifiedFirstBatch[1], {
    name: "deleteNode",
    value: {
      actionTracingId,
      nodeId: 3,
      treeId: 2,
    },
  });
  t.is(simplifiedFirstBatch[2].name, "deleteEdge");
  t.is(simplifiedFirstBatch[3].name, "deleteEdge");
  t.is(simplifiedFirstBatch.length, 4);
});
