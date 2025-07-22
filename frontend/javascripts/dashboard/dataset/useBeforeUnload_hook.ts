import { useCallback, useEffect, useRef } from "react";
import { type BlockerFunction, useBlocker } from "react-router-dom";

const useBeforeUnload = (hasUnsavedChanges: boolean, message: string) => {
  const beforeUnload = useCallback(
    (args: BeforeUnloadEvent | BlockerFunction): boolean | undefined => {
      // Navigation blocking can be triggered by two sources:
      // 1. The browser's native beforeunload event
      // 2. The React-Router block function (useBlocker or withBlocker HOC)

      if (hasUnsavedChanges && !location.pathname.startsWith("/datasets")) {
        window.onbeforeunload = null; // clear the event handler otherwise it would be called twice. Once from history.block once from the beforeunload event
        blockTimeoutIdRef.current = window.setTimeout(() => {
          // restore the event handler in case a user chose to stay on the page
          window.onbeforeunload = beforeUnload;
        }, 500);
        // The native event requires a truthy return value to show a generic message
        // The React Router blocker accepts a boolean
        return "preventDefault" in args ? true : !confirm(message);
      }
      // The native event requires an empty return value to not show a message
      return;
    },
    [hasUnsavedChanges, message],
  );

  // @ts-ignore beforeUnload signature is overloaded
  const blocker = useBlocker(beforeUnload);
  const blockTimeoutIdRef = useRef<number | null>(null);

  const unblockHistory = useCallback(() => {
    window.onbeforeunload = null;
    if (blockTimeoutIdRef.current != null) {
      clearTimeout(blockTimeoutIdRef.current);
      blockTimeoutIdRef.current = null;
    }
    blocker.reset ? blocker.reset() : void 0;
  }, [blocker.reset]);

  useEffect(() => {
    window.onbeforeunload = beforeUnload;

    return () => {
      unblockHistory();
    };
  }, [unblockHistory, beforeUnload]);
};

export default useBeforeUnload;
