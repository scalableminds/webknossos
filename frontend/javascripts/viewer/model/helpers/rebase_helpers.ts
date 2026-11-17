import { getIsRebasingOrForwarding } from "viewer/model/accessors/annotation_accessor";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { Store } from "viewer/singletons";

// Kept separate from bounding_box_creation_helpers.ts, which imports the scene controller, so that
// non-viewer code (e.g. the dashboard via identity_block.tsx) can use it without pulling in the viewer.

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
