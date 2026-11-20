import { useCallback, useEffect, useMemo } from "react";
import { type BlockerFunction, useBlocker } from "react-router";

/**
 * Creates the handler that asks the user to confirm leaving the page while there are
 * unsaved changes, and a function that cancels the pending restore of window.onbeforeunload.
 */
function createBeforeUnloadHandler(hasUnsavedChanges: boolean, message: string) {
  let restoreTimeoutId: number | null = null;

  const beforeUnload = (args: BeforeUnloadEvent | BlockerFunction): boolean | undefined => {
    // Navigation blocking can be triggered by two sources:
    // 1. The browser's native beforeunload event
    // 2. The React-Router block function (useBlocker or withBlocker HOC)

    if (hasUnsavedChanges && !location.pathname.startsWith("/datasets")) {
      window.onbeforeunload = null; // clear the event handler otherwise it would be called twice. Once from history.block once from the beforeunload event
      restoreTimeoutId = window.setTimeout(() => {
        // restore the event handler in case a user chose to stay on the page
        window.onbeforeunload = beforeUnload;
      }, 500);
      // The native event requires a truthy return value to show a generic message
      // The React Router blocker accepts a boolean
      return "preventDefault" in args ? true : !confirm(message);
    }
    // The native event requires an empty return value to not show a message
    return;
  };

  const cancelRestore = () => {
    if (restoreTimeoutId != null) {
      clearTimeout(restoreTimeoutId);
      restoreTimeoutId = null;
    }
  };

  return { beforeUnload, cancelRestore };
}

const useBeforeUnload = (hasUnsavedChanges: boolean, message: string) => {
  const { beforeUnload, cancelRestore } = useMemo(
    () => createBeforeUnloadHandler(hasUnsavedChanges, message),
    [hasUnsavedChanges, message],
  );

  // @ts-expect-error beforeUnload signature is overloaded
  const blocker = useBlocker(beforeUnload);

  const unblockHistory = useCallback(() => {
    window.onbeforeunload = null;
    cancelRestore();
    blocker.reset ? blocker.reset() : void 0;
  }, [cancelRestore, blocker]);

  useEffect(() => {
    window.onbeforeunload = beforeUnload;

    return () => {
      unblockHistory();
    };
  }, [unblockHistory, beforeUnload]);
};

export default useBeforeUnload;
