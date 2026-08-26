import type { Dispatch } from "redux";
import type { Vector3 } from "viewer/constants";
import { getIsRebasingOrForwarding } from "viewer/model/accessors/annotation_accessor";
import { dispatchGetNewIdAsync } from "viewer/model/actions/actions";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { Store } from "viewer/singletons";
import type { UserBoundingBoxWithoutId } from "viewer/store";

// Resolves once no rebase/forwarding is active. If none is active, resolves immediately; otherwise
// it subscribes to the store and resolves as soon as isRebasingOrForwarding flips back to false
// (then unsubscribes). This is used to defer local edits that would otherwise be dropped or lost
// while a rebase/forwarding round is in progress -- e.g. bounding box creation (which would be
// dropped by the rebase edit guard, see rebase_edit_guard.ts) and annotation-layer-name/
// description edits (which the save-queue diffing saga in save_queue_filling_saga.ts would
// silently ignore and then lose once it resets its baseline after the rebase finishes).
export function waitUntilRebaseFinished(): Promise<void> {
  if (!getIsRebasingOrForwarding(Store.getState())) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const unsubscribe = listenToStoreProperty(
      getIsRebasingOrForwarding,
      (isRebasingOrForwarding) => {
        if (!isRebasingOrForwarding) {
          // Note that listenToStoreProperty does not call the handler synchronously on subscribe
          // (callHandlerOnSubscribe defaults to false), so `unsubscribe` is always assigned here.
          unsubscribe();
          resolve();
        }
      },
    );
  });
}

// Reserves a bounding box id and adds a new user bounding box, deferring the actual add until any
// active rebase/forwarding has finished if there is such an active operation.
export async function reserveIdAndAddBoundingBox(
  dispatch: Dispatch<any>,
  tracingId: string,
  newBoundingBox: Partial<UserBoundingBoxWithoutId> | null = null,
  center: Vector3 | undefined = undefined,
): Promise<void> {
  const id = await dispatchGetNewIdAsync(dispatch, tracingId, "BoundingBox");
  await waitUntilRebaseFinished();
  dispatch(addUserBoundingBoxAction(newBoundingBox, center, id));
}
