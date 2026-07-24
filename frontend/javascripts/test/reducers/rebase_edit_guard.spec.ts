import {
  setupWebknossosForTestingWithRestrictions,
  type WebknossosTestContext,
} from "test/helpers/apiHelpers";
import type { Vector3 } from "viewer/constants";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import {
  finishForwardingUpdateActionsAction,
  startForwardingUpdateActionsAction,
} from "viewer/model/actions/save_actions";
import {
  applyVolumeUpdateActionsFromServerAction,
  setMappingIsLockedAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import {
  type ApplicableVolumeServerUpdateAction,
  addUserBoundingBoxInVolumeTracing,
} from "viewer/model/sagas/volume/update_actions";
import { Store } from "viewer/singletons";
import type { UserBoundingBox } from "viewer/store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// These tests exercise withRebaseEditGuard as it is actually wired into the store (see store.ts),
// i.e. against the real reducer chain and a real (test-)annotation, rather than a hand-rolled state
// plus a mock reducer. They verify that while a rebase/forwarding is active, user editing actions
// are dropped, whereas the actions the rebase machinery replays keep being applied.

// The user bounding boxes are mirrored across all tracings; we read them from the volume tracing so
// that boxes added via a volume-scoped server update action (see the replay test) are observed too.
function getBoundingBoxes(): UserBoundingBox[] {
  return Store.getState().annotation.volumes[0].userBoundingBoxes;
}

function nextBoundingBoxId(): number {
  return Math.max(0, ...getBoundingBoxes().map((bbox) => bbox.id)) + 1;
}

describe("withRebaseEditGuard (integrated into the real store)", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTestingWithRestrictions(context, "Concurrent", true, false, "hybrid");
  });

  afterEach<WebknossosTestContext>((context) => {
    context.tearDownPullQueues();
    expect(hasRootSagaCrashed()).toBe(false);
  });

  it("drops a user bounding-box creation while rebasing and applies it once finished", () => {
    const countBefore = getBoundingBoxes().length;

    // While a rebase/forwarding is active, the edit is dropped.
    Store.dispatch(startForwardingUpdateActionsAction());
    Store.dispatch(addUserBoundingBoxAction(null, undefined, nextBoundingBoxId()));
    expect(getBoundingBoxes().length).toBe(countBefore);

    // Once it finished, the same kind of edit goes through again — proving it was only dropped
    // because of the active rebase, not because the action is inert.
    Store.dispatch(finishForwardingUpdateActionsAction());
    Store.dispatch(addUserBoundingBoxAction(null, undefined, nextBoundingBoxId()));
    expect(getBoundingBoxes().length).toBe(countBefore + 1);
  });

  it("drops another save-relevant edit (segment update) while rebasing and applies it once finished", () => {
    const { tracingId: volumeTracingId } = Store.getState().annotation.volumes[0];
    const segmentId = 777;
    const getSegment = () => Store.getState().annotation.volumes[0].segments.getNullable(segmentId);
    expect(getSegment()).toBeUndefined();

    // While a rebase/forwarding is active, the segment edit is dropped.
    Store.dispatch(startForwardingUpdateActionsAction());
    Store.dispatch(updateSegmentAction(segmentId, { name: "Guarded" }, volumeTracingId));
    expect(getSegment()).toBeUndefined();

    // Once it finished, the same edit goes through.
    Store.dispatch(finishForwardingUpdateActionsAction());
    Store.dispatch(updateSegmentAction(segmentId, { name: "Applied" }, volumeTracingId));
    expect(getSegment()).toMatchObject({ id: segmentId, name: "Applied" });
  });

  it("keeps applying actions replayed by the rebase machinery while rebasing", () => {
    const { tracingId: volumeTracingId } = Store.getState().annotation.volumes[0];
    const countBefore = getBoundingBoxes().length;

    Store.dispatch(startForwardingUpdateActionsAction());

    // A mapping action is dispatched by the rebase itself (see save_saga.tsx) -> must be applied.
    expect(Store.getState().annotation.volumes[0].mappingIsLocked).toBeFalsy();
    Store.dispatch(setMappingIsLockedAction(volumeTracingId));
    expect(Store.getState().annotation.volumes[0].mappingIsLocked).toBe(true);

    // A user-initiated bbox add is dropped...
    Store.dispatch(addUserBoundingBoxAction(null, undefined, nextBoundingBoxId()));
    expect(getBoundingBoxes().length).toBe(countBefore);

    // ...but a bbox replayed from the server (APPLY_VOLUME_UPDATE_ACTIONS_FROM_SERVER, which is not
    // save-relevant and therefore not guarded) is applied even while rebasing.
    const replayedBox = {
      id: 12345,
      name: "Replayed box",
      color: [1, 2, 3] as Vector3,
      isVisible: true,
      boundingBox: { min: [0, 0, 0] as Vector3, max: [1, 1, 1] as Vector3 },
    };
    Store.dispatch(
      applyVolumeUpdateActionsFromServerAction([
        addUserBoundingBoxInVolumeTracing(
          replayedBox,
          volumeTracingId,
        ) as ApplicableVolumeServerUpdateAction,
      ]),
    );
    expect(getBoundingBoxes().length).toBe(countBefore + 1);
    expect(getBoundingBoxes().some((bbox) => bbox.id === replayedBox.id)).toBe(true);

    Store.dispatch(finishForwardingUpdateActionsAction());
  });
});
