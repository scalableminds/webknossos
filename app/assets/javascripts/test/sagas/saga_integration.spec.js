import test from "ava";
import mockRequire from "mock-require";
import { setupOxalis, TIMESTAMP } from "test/helpers/apiHelpers";
import update from "immutability-helper";
import Store from "oxalis/store";
import { wkReadyAction } from "oxalis/model/actions/actions";
import { createSaveQueueFromUpdateActions } from "test/helpers/saveHelpers";
import { generateTreeName } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { getStats } from "oxalis/model/accessors/skeletontracing_accessor";
import Utils from "libs/utils";

const UpdateActions = mockRequire.reRequire("oxalis/model/sagas/update_actions");

test.beforeEach(async t => {
  // Setup oxalis, this will execute model.fetch(...) and initialize the store with the tracing, etc.
  await setupOxalis(t, "task");
  // Dispatch the wkReadyAction, so the sagas are started
  Store.dispatch(wkReadyAction());
});

test("watchTreeNames saga should rename empty trees in tasks and these updates should be persisted", t => {
  const state = Store.getState();
  const treeWithEmptyName = state.tracing.trees[1];
  const treeWithCorrectName = update(treeWithEmptyName, {
    name: { $set: generateTreeName(state, treeWithEmptyName.timestamp, treeWithEmptyName.treeId) },
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
});
