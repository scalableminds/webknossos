// @flow
import update from "immutability-helper";

import { __setupOxalis, TIMESTAMP } from "test/helpers/apiHelpers";
import { createSaveQueueFromUpdateActions } from "test/helpers/saveHelpers";
import { enforceSkeletonTracing, getStats } from "oxalis/model/accessors/skeletontracing_accessor";
import { maximumActionCountPerBatch } from "oxalis/model/sagas/save_saga";
import { restartSagaAction, wkReadyAction } from "oxalis/model/actions/actions";
import Store from "oxalis/store";
import * as Utils from "libs/utils";
import generateDummyTrees from "oxalis/model/helpers/generate_dummy_trees";
import mockRequire from "mock-require";
import test from "ava";

const {
  createTreeMapFromTreeArray,
  generateTreeName,
} = require("oxalis/model/reducers/skeletontracing_reducer_helpers");

const { addTreesAndGroupsAction, deleteNodeAction } = mockRequire.reRequire(
  "oxalis/model/actions/skeletontracing_actions",
);
const { discardSaveQueuesAction } = mockRequire.reRequire("oxalis/model/actions/save_actions");
const UpdateActions = mockRequire.reRequire("oxalis/model/sagas/update_actions");

test.beforeEach(async t => {
  // Setup oxalis, this will execute model.fetch(...) and initialize the store with the tracing, etc.
  Store.dispatch(restartSagaAction());
  Store.dispatch(discardSaveQueuesAction());
  await __setupOxalis(t, "task");

  // Dispatch the wkReadyAction, so the sagas are started
  Store.dispatch(wkReadyAction());
});

test.serial(
  "watchTreeNames saga should rename empty trees in tasks and these updates should be persisted",
  t => {
    const state = Store.getState();
    const treeWithEmptyName = enforceSkeletonTracing(state.tracing).trees[1];
    const treeWithCorrectName = update(treeWithEmptyName, {
      name: {
        $set: generateTreeName(state, treeWithEmptyName.timestamp, treeWithEmptyName.treeId),
      },
    });

    const expectedSaveQueue = createSaveQueueFromUpdateActions(
      [
        [
          UpdateActions.updateTree(treeWithCorrectName),
          UpdateActions.updateSkeletonTracing(
            Store.getState().tracing.skeleton,
            [1, 2, 3],
            [0, 0, 0],
            2,
          ),
        ],
      ],
      TIMESTAMP,
      Utils.toNullable(getStats(state.tracing)),
    );

    // Once the updateTree update action is in the save queue, we're good.
    // This means the setTreeName action was dispatched, the diffing ran, and the change will be persisted.
    t.deepEqual(expectedSaveQueue, state.save.queue.skeleton);
  },
);

test.serial("Save actions should not be chunked below the chunk limit (1/3)", t => {
  Store.dispatch(discardSaveQueuesAction());
  t.deepEqual(Store.getState().save.queue.skeleton, []);

  const trees = generateDummyTrees(1000, 1);
  Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));
  t.is(Store.getState().save.queue.skeleton.length, 1);
  t.true(Store.getState().save.queue.skeleton[0].actions.length < maximumActionCountPerBatch);
});

test.serial("Save actions should be chunked above the chunk limit (2/3)", t => {
  Store.dispatch(discardSaveQueuesAction());
  t.deepEqual(Store.getState().save.queue.skeleton, []);

  const trees = generateDummyTrees(5000, 1);
  Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));

  const state = Store.getState();

  t.true(state.save.queue.skeleton.length > 1);
  t.is(state.save.queue.skeleton[0].actions.length, maximumActionCountPerBatch);
});

test.serial("Save actions should be chunked after compacting (3/3)", t => {
  const nodeCount = 20000;
  // Test that a tree split is detected even when the involved node count is above the chunk limit
  const trees = generateDummyTrees(1, nodeCount);
  Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));

  Store.dispatch(discardSaveQueuesAction());
  t.deepEqual(Store.getState().save.queue.skeleton, []);
  t.deepEqual(Store.getState().save.queue.volume, []);

  // Delete node in the middle
  const middleNodeId = trees[0].nodes[nodeCount / 2].id;
  Store.dispatch(deleteNodeAction(middleNodeId));
  const { skeleton: skeletonSaveQueue, volume: volumeSaveQueue } = Store.getState().save.queue;

  // There should only be one chunk
  t.is(skeletonSaveQueue.length, 1);
  t.is(volumeSaveQueue.length, 0);
  t.true(skeletonSaveQueue[0].actions.length < maximumActionCountPerBatch);
  t.is(skeletonSaveQueue[0].actions[1].name, "moveTreeComponent");
  const updateActionValue = skeletonSaveQueue[0].actions[1].value;
  if (updateActionValue.nodeIds == null || !Array.isArray(updateActionValue.nodeIds)) {
    throw new Error("No node ids in save action found");
  }
  t.true(updateActionValue.nodeIds.length >= nodeCount / 2);
});
