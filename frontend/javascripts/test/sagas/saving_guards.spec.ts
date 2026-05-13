import { sleep } from "libs/utils";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import {
  setCollaborationModeAction,
  setIsUpdatingAnnotationCurrentlyAllowedAction,
} from "viewer/model/actions/annotation_actions";
import {
  disableSavingAction,
  dispatchEnsureHasNewestVersionAsync,
} from "viewer/model/actions/save_actions";
import { createNodeAction, createTreeAction } from "viewer/model/actions/skeletontracing_actions";
import { setPositionAction } from "viewer/model/actions/flycam_actions";
import { setVersionRestoreVisibilityAction } from "viewer/model/actions/ui_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import Store from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Model } from "viewer/singletons";

describe("Saving guards", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    expect(hasRootSagaCrashed()).toBe(false);
    // Deliberately not calling api.tracing.save() here: some tests disable saving,
    // which would cause ensureSavedState() to hang waiting for a queue that won't drain.
    context.tearDownPullQueues();
  });

  it<WebknossosTestContext>("should not drain the save queue after disableSavingAction is dispatched", async (context) => {
    // Ensure the queue is clean before the test creates new changes.
    await context.api.tracing.save();

    // Create a change so the save queue is non-empty and the draining saga wakes up.
    Store.dispatch(createNodeAction([1, 1, 1], [], [0, 0, 0], 0, 0));

    // Disable saving while the draining saga is in the throttle/race phase.
    Store.dispatch(disableSavingAction());

    const saveCountBefore = context.receivedDataPerSaveRequest.length;

    // Force a save attempt — the guard (checked after the race fires) should block it.
    Store.dispatch({ type: "SAVE_NOW" });

    // Also provoke via dispatchEnsureHasNewestVersionAsync (which watchForNewerAnnotationVersion
    // should handle without deadlocking, and which should not cause a save).
    let ensureResolved = false;
    dispatchEnsureHasNewestVersionAsync(Store.dispatch).then(() => {
      ensureResolved = true;
    });

    await sleep(200);

    expect(context.receivedDataPerSaveRequest.length).toBe(saveCountBefore);
    // The ensure-newest-version promise fulfills immediately because the sole-editor
    // path fulfills the callback right away (no version restore is blocking it).
    expect(ensureResolved).toBe(true);
  });

  it<WebknossosTestContext>("should not drain the save queue while the version restore view is open", async (context) => {
    // Ensure the queue is clean before the test creates changes.
    await context.api.tracing.save();

    // Create a change — the draining saga wakes up and enters the throttle race.
    Store.dispatch(createNodeAction([1, 1, 1], [], [0, 0, 0], 0, 0));

    // Open version restore while the race is running (before SAVE_NOW fires).
    // The guard is checked after the race, so it will catch this.
    Store.dispatch(setVersionRestoreVisibilityAction(true));
    Store.dispatch(setIsUpdatingAnnotationCurrentlyAllowedAction(false));

    const saveCountAfterOpen = context.receivedDataPerSaveRequest.length;

    // Force-push: the race fires, then the guard blocks the drain.
    Store.dispatch({ type: "SAVE_NOW" });
    await sleep(200);

    expect(context.receivedDataPerSaveRequest.length).toBe(saveCountAfterOpen);

    // Close version restore — the guard unblocks and the pending drain completes.
    Store.dispatch(setVersionRestoreVisibilityAction(false));
    Store.dispatch(setIsUpdatingAnnotationCurrentlyAllowedAction(true));

    await context.api.tracing.save();

    expect(context.receivedDataPerSaveRequest.length).toBeGreaterThan(saveCountAfterOpen);
  });

  it<WebknossosTestContext>("ENSURE_HAS_NEWEST_VERSION callback should not fire while version restore is open, but should fire after it closes", async (context) => {
    await context.api.tracing.save();
    Store.dispatch(setCollaborationModeAction("Concurrent"));
    Store.dispatch(setVersionRestoreVisibilityAction(true));
    Store.dispatch(setIsUpdatingAnnotationCurrentlyAllowedAction(false));

    let ensureResolved = false;
    const ensurePromise = dispatchEnsureHasNewestVersionAsync(Store.dispatch).then(() => {
      ensureResolved = true;
    });

    await sleep(200);
    expect(ensureResolved).toBe(false);

    // Close version restore — watchForNewerAnnotationVersion should re-enqueue the
    // ENSURE_HAS_NEWEST_VERSION action and eventually fulfill its callback.
    Store.dispatch(setVersionRestoreVisibilityAction(false));
    Store.dispatch(setIsUpdatingAnnotationCurrentlyAllowedAction(true));

    await ensurePromise;
    expect(ensureResolved).toBe(true);

    await context.api.tracing.save();
  });

  it<WebknossosTestContext>("should not fill the save queue in a read-only annotation", async (context) => {
    await context.api.tracing.save();

    Store.dispatch(setIsUpdatingAnnotationCurrentlyAllowedAction(false));

    const treeCountBefore = Store.getState().annotation.skeleton?.trees.size() ?? 0;

    // Camera updates should reach the store (flycam reducer is unguarded).
    Store.dispatch(setPositionAction([100, 200, 300]));
    // Tree creation must be blocked by the skeleton reducer in read-only mode.
    Store.dispatch(createTreeAction());

    await Model.ensureSavedState();

    // Camera position must have been updated in the store.
    const matrix = Store.getState().flycam.currentMatrix;
    expect(matrix[12]).toBe(100);
    expect(matrix[13]).toBe(200);
    expect(matrix[14]).toBe(300);

    // No new tree must have been added to the skeleton.
    expect(Store.getState().annotation.skeleton?.trees.size() ?? 0).toBe(treeCountBefore);

    // No skeleton update actions (e.g. createTree) must have reached the server.
    const allSentActions = context.receivedDataPerSaveRequest.flatMap((batch) =>
      batch.flatMap((entry) => entry.actions),
    );
    expect(allSentActions).toEqual([]);
  });
});
