import update from "immutability-helper";
import mockRequire from "mock-require";
import test from "ava";
import "test/sagas/saga_integration.mock.js";
import { __setupOxalis, TIMESTAMP } from "test/helpers/apiHelpers";
import { createSaveQueueFromUpdateActions } from "test/helpers/saveHelpers";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { getStats } from "oxalis/model/accessors/annotation_accessor";
import { MAXIMUM_ACTION_COUNT_PER_BATCH } from "oxalis/model/sagas/save_saga_constants";
import { restartSagaAction, wkReadyAction } from "oxalis/model/actions/actions";
import Store from "oxalis/store";
import generateDummyTrees from "oxalis/model/helpers/generate_dummy_trees";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import dummyUser from "test/fixtures/dummy_user";
import { hasRootSagaCrashed } from "oxalis/model/sagas/root_saga";
import { omit } from "lodash";

const { createTreeMapFromTreeArray, generateTreeName } =
  require("oxalis/model/reducers/skeletontracing_reducer_helpers") as typeof import(
    "oxalis/model/reducers/skeletontracing_reducer_helpers",
  );

const { addTreesAndGroupsAction, deleteNodeAction } = mockRequire.reRequire(
  "oxalis/model/actions/skeletontracing_actions",
) as typeof import("oxalis/model/actions/skeletontracing_actions");
const { discardSaveQueuesAction } = mockRequire.reRequire(
  "oxalis/model/actions/save_actions",
) as typeof import("oxalis/model/actions/save_actions");
const UpdateActions = mockRequire.reRequire("oxalis/model/sagas/update_actions") as typeof import(
  "oxalis/model/sagas/update_actions",
);

test.beforeEach(async (t) => {
  // Setup oxalis, this will execute model.fetch(...) and initialize the store with the tracing, etc.
  Store.dispatch(restartSagaAction());
  Store.dispatch(discardSaveQueuesAction());
  Store.dispatch(setActiveUserAction(dummyUser));
  await __setupOxalis(t, "task");
  // Dispatch the wkReadyAction, so the sagas are started
  Store.dispatch(wkReadyAction());
});

test.afterEach(async (t) => {
  // Saving after each test and checking that the root saga didn't crash,
  // ensures that each test is cleanly exited. Without it weird output can
  // occur (e.g., a promise gets resolved which interferes with the next test).
  t.false(hasRootSagaCrashed());
});

test.serial(
  "watchTreeNames saga should rename empty trees in tasks and these updates should be persisted",
  (t) => {
    const state = Store.getState();
    const skeletonTracing = enforceSkeletonTracing(state.tracing);
    const treeWithEmptyName = skeletonTracing.trees[1];
    const treeWithCorrectName = update(treeWithEmptyName, {
      name: {
        $set: generateTreeName(state, treeWithEmptyName.timestamp, treeWithEmptyName.treeId),
      },
    });
    const expectedSaveQueue = createSaveQueueFromUpdateActions(
      [
        [
          UpdateActions.updateTree(treeWithCorrectName, skeletonTracing.tracingId),
          UpdateActions.updateSkeletonTracing(
            enforceSkeletonTracing(Store.getState().tracing),
            [1, 2, 3],
            [],
            [0, 0, 0],
            2,
          ),
        ],
      ],
      TIMESTAMP,
      getStats(state.tracing) || undefined,
    );
    // Reset the info field which is just for debugging purposes
    const actualSaveQueue = state.save.queue.map((entry) => {
      return { ...omit(entry, "info"), info: "[]" };
    });
    // Once the updateTree update action is in the save queue, we're good.
    // This means the setTreeName action was dispatched, the diffing ran, and the change will be persisted.
    t.deepEqual(expectedSaveQueue, actualSaveQueue);
  },
);

test.serial("Save actions should not be chunked below the chunk limit (1/3)", (t) => {
  Store.dispatch(discardSaveQueuesAction());
  t.deepEqual(Store.getState().save.queue, []);
  // This will create 250 trees with one node each. Thus, 500 update actions will
  // be sent to the server (two per node).
  const trees = generateDummyTrees(250, 1);
  Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));
  t.is(Store.getState().save.queue.length, 1);
  t.true(Store.getState().save.queue[0].actions.length < MAXIMUM_ACTION_COUNT_PER_BATCH);
});

test.serial("Save actions should be chunked above the chunk limit (2/3)", (t) => {
  Store.dispatch(discardSaveQueuesAction());
  t.deepEqual(Store.getState().save.queue, []);
  const trees = generateDummyTrees(5000, 2);
  Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));
  const state = Store.getState();
  t.true(state.save.queue.length > 1);
  t.is(state.save.queue[0].actions.length, MAXIMUM_ACTION_COUNT_PER_BATCH);
});

test.serial("Save actions should be chunked after compacting (3/3)", (t) => {
  const nodeCount = 20000;
  // Test that a tree split is detected even when the involved node count is above the chunk limit
  const trees = generateDummyTrees(1, nodeCount);
  Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));
  Store.dispatch(discardSaveQueuesAction());
  t.deepEqual(Store.getState().save.queue, []);
  // Delete some node, NOTE that this is not the node in the middle of the tree!
  // The addTreesAndGroupsAction gives new ids to nodes and edges in a non-deterministic way.
  const middleNodeId = trees[0].nodes[nodeCount / 2].id;
  Store.dispatch(deleteNodeAction(middleNodeId));
  const skeletonSaveQueue = Store.getState().save.queue;
  // There should only be one chunk
  t.is(skeletonSaveQueue.length, 1);
  t.true(skeletonSaveQueue[0].actions.length < MAXIMUM_ACTION_COUNT_PER_BATCH);
  t.is(skeletonSaveQueue[0].actions[1].name, "moveTreeComponent");
});
