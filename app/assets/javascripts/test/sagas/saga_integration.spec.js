import test from "ava";
import mockRequire from "mock-require";
import { setupOxalis, TIMESTAMP } from "test/helpers/apiHelpers";
import update from "immutability-helper";
import Store from "oxalis/store";
import { restartSagaAction, wkReadyAction } from "oxalis/model/actions/actions";
import { createSaveQueueFromUpdateActions } from "test/helpers/saveHelpers";
import { generateTreeName } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { getStats } from "oxalis/model/accessors/skeletontracing_accessor";
import Utils from "libs/utils";
import generateDummyTrees from "oxalis/model/helpers/generate_dummy_trees";
import { maximumActionCountPerBatch } from "oxalis/model/sagas/save_saga";

const UpdateActions = mockRequire.reRequire("oxalis/model/sagas/update_actions");
const { addTreesAndGroupsAction, deleteNodeAction } = mockRequire.reRequire(
  "oxalis/model/actions/skeletontracing_actions",
);
const { createTreeMapFromTreeArray } = mockRequire.reRequire(
  "oxalis/model/reducers/skeletontracing_reducer_helpers",
);
const { discardSaveQueueAction } = mockRequire.reRequire("oxalis/model/actions/save_actions");

test.beforeEach(async t => {
  // Setup oxalis, this will execute model.fetch(...) and initialize the store with the tracing, etc.
  Store.dispatch(restartSagaAction());
  Store.dispatch(discardSaveQueueAction());
  await setupOxalis(t, "task");

  // Dispatch the wkReadyAction, so the sagas are started
  Store.dispatch(wkReadyAction());
});

test.serial(
  "watchTreeNames saga should rename empty trees in tasks and these updates should be persisted",
  t => {
    const state = Store.getState();
    const treeWithEmptyName = state.tracing.trees[1];
    const treeWithCorrectName = update(treeWithEmptyName, {
      name: {
        $set: generateTreeName(state, treeWithEmptyName.timestamp, treeWithEmptyName.treeId),
      },
    });

    const expectedSaveQueue = createSaveQueueFromUpdateActions(
      [
        [
          UpdateActions.updateTree(treeWithCorrectName),
          UpdateActions.updateSkeletonTracing(Store.getState().tracing, [1, 2, 3], [0, 0, 0], 2),
        ],
      ],
      TIMESTAMP,
      Utils.toNullable(getStats(state.tracing)),
    );

    // Once the updateTree update action is in the save queue, we're good.
    // This means the setTreeName action was dispatched, the diffing ran, and the change will be persisted.
    t.deepEqual(expectedSaveQueue, state.save.queue);
  },
);

test.serial("Save actions should not be chunked below the chunk limit (1/3)", t => {
  Store.dispatch(discardSaveQueueAction());
  t.deepEqual(Store.getState().save.queue, []);

  const trees = generateDummyTrees(1000, 1);
  Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));
  t.is(Store.getState().save.queue.length, 1);
  t.true(Store.getState().save.queue[0].actions.length < maximumActionCountPerBatch);
});

test.serial("Save actions should be chunked above the chunk limit (2/3)", t => {
  Store.dispatch(discardSaveQueueAction());
  t.deepEqual(Store.getState().save.queue, []);

  const trees = generateDummyTrees(5000, 1);
  Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));

  const state = Store.getState();

  t.true(state.save.queue.length > 1);
  t.is(state.save.queue[0].actions.length, maximumActionCountPerBatch);
});

test.serial("Save actions should be chunked after compacting (3/3)", t => {
  const nodeCount = 20000;
  // Test that a tree split is detected even when the involved node count is above the chunk limit
  const trees = generateDummyTrees(1, nodeCount);
  Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));

  Store.dispatch(discardSaveQueueAction());
  t.deepEqual(Store.getState().save.queue, []);

  // Delete node in the middle
  const middleNodeId = trees[0].nodes[nodeCount / 2].id;
  Store.dispatch(deleteNodeAction(middleNodeId));
  const saveQueue = Store.getState().save.queue;

  // There should only be one chunk
  t.is(saveQueue.length, 1);
  t.true(saveQueue[0].actions.length < maximumActionCountPerBatch);
  t.is(saveQueue[0].actions[1].name, "moveTreeComponent");
  t.true(saveQueue[0].actions[1].value.nodeIds.length >= nodeCount / 2);
});
