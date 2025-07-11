import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import { createSaveQueueFromUpdateActions } from "test/helpers/saveHelpers";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { getStats } from "viewer/model/accessors/annotation_accessor";
import { MAXIMUM_ACTION_COUNT_PER_BATCH } from "viewer/model/sagas/saving/save_saga_constants";
import Store from "viewer/store";
import generateDummyTrees from "viewer/model/helpers/generate_dummy_trees";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { omit } from "lodash";

import {
  createTreeMapFromTreeArray,
  generateTreeName,
} from "viewer/model/reducers/skeletontracing_reducer_helpers";

import {
  addTreesAndGroupsAction,
  deleteNodeAction,
} from "viewer/model/actions/skeletontracing_actions";
import { discardSaveQueuesAction } from "viewer/model/actions/save_actions";
import * as UpdateActions from "viewer/model/sagas/volume/update_actions";
import { TIMESTAMP } from "test/global_mocks";

describe("Saga Integration Tests", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "task");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    context.tearDownPullQueues();
    // Saving after each test and checking that the root saga didn't crash,
    // ensures that each test is cleanly exited. Without it weird output can
    // occur (e.g., a promise gets resolved which interferes with the next test).
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("watchTreeNames saga should rename empty trees in tasks and these updates should be persisted", () => {
    const state = Store.getState();
    const skeletonTracing = enforceSkeletonTracing(state.annotation);
    const treeWithEmptyName = skeletonTracing.trees.getOrThrow(1);
    const treeWithCorrectName = {
      ...treeWithEmptyName,
      name: generateTreeName(state, treeWithEmptyName.timestamp, treeWithEmptyName.treeId),
    };
    const expectedSaveQueue = createSaveQueueFromUpdateActions(
      [[UpdateActions.updateTree(treeWithCorrectName, skeletonTracing.tracingId)]],
      TIMESTAMP,
      getStats(state.annotation) || undefined,
    );
    // Reset the info field which is just for debugging purposes
    const actualSaveQueue = state.save.queue.map((entry) => {
      return { ...omit(entry, "info"), info: "[]" };
    });
    // Once the updateTree update action is in the save queue, we're good.
    // This means the setTreeName action was dispatched, the diffing ran, and the change will be persisted.
    expect(expectedSaveQueue).toEqual(actualSaveQueue);
  });

  it("Save actions should not be chunked below the chunk limit (1/3)", () => {
    Store.dispatch(discardSaveQueuesAction());
    expect(Store.getState().save.queue).toEqual([]);

    // This will create 250 trees with one node each. Thus, 500 update actions will
    // be sent to the server (two per node).
    const trees = generateDummyTrees(250, 1);
    Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));

    expect(Store.getState().save.queue.length).toBe(1);
    expect(Store.getState().save.queue[0].actions.length).toBeLessThan(
      MAXIMUM_ACTION_COUNT_PER_BATCH,
    );
  });

  it("Save actions should be chunked above the chunk limit (2/3)", () => {
    Store.dispatch(discardSaveQueuesAction());
    expect(Store.getState().save.queue).toEqual([]);

    const trees = generateDummyTrees(5000, 2);
    Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));
    const state = Store.getState();

    expect(state.save.queue.length).toBeGreaterThan(1);
    expect(state.save.queue[0].actions.length).toBe(MAXIMUM_ACTION_COUNT_PER_BATCH);
  });

  it("Save actions should be chunked after compacting (3/3)", () => {
    const nodeCount = 20_000;
    // Test that a tree split is detected even when the involved node count is above the chunk limit
    const trees = generateDummyTrees(1, nodeCount);

    Store.dispatch(addTreesAndGroupsAction(createTreeMapFromTreeArray(trees), []));
    Store.dispatch(discardSaveQueuesAction());
    expect(Store.getState().save.queue).toEqual([]);
    // Delete some node, NOTE that this is not the node in the middle of the tree!
    // The addTreesAndGroupsAction gives new ids to nodes and edges in a non-deterministic way.
    const middleNodeId = trees[0].nodes[nodeCount / 2].id;
    Store.dispatch(deleteNodeAction(middleNodeId));
    const skeletonSaveQueue = Store.getState().save.queue;

    expect(skeletonSaveQueue.length).toBe(2);
    expect(skeletonSaveQueue[1].actions.length).toBeLessThan(MAXIMUM_ACTION_COUNT_PER_BATCH);
    expect(skeletonSaveQueue[1].actions[1].name).toBe("moveTreeComponent");
  });
});
