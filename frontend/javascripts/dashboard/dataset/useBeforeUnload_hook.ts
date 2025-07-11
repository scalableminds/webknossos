import type {
  Action as HistoryAction,
  Location as HistoryLocation,
  UnregisterCallback,
} from "history";
import { useCallback, useEffect, useRef } from "react";
import { useHistory } from "react-router-dom";

const useBeforeUnload = (hasUnsavedChanges: boolean, message: string) => {
  const history = useHistory();
  const unblockRef = useRef<UnregisterCallback | null>(null);
  const blockTimeoutIdRef = useRef<number | null>(null);

  const unblockHistory = useCallback(() => {
    window.onbeforeunload = null;
    if (blockTimeoutIdRef.current != null) {
      clearTimeout(blockTimeoutIdRef.current);
      blockTimeoutIdRef.current = null;
    }
    if (unblockRef.current != null) {
      unblockRef.current();
      unblockRef.current = null;
    }
  }, []);

  useEffect(() => {
    const beforeUnload = (
      newLocation: HistoryLocation<unknown>,
      action: HistoryAction,
    ): string | false | void => {
      // Only show the prompt if this is a proper beforeUnload event from the browser
      // or the pathname changed
      // This check has to be done because history.block triggers this function even if only the url hash changed
      if (action === undefined || !newLocation.pathname.includes("/datasets")) {
        if (hasUnsavedChanges) {
          window.onbeforeunload = null; // clear the event handler otherwise it would be called twice. Once from history.block once from the beforeunload event
          blockTimeoutIdRef.current = window.setTimeout(() => {
            // restore the event handler in case a user chose to stay on the page
            // @ts-ignore
            window.onbeforeunload = beforeUnload;
          }, 500);
          return message;
        }
      }
      return;
    };

    unblockRef.current = history.block(beforeUnload);
    // @ts-ignore
    window.onbeforeunload = beforeUnload;

    return () => {
      unblockHistory();
    };
  }, [history, hasUnsavedChanges, message, unblockHistory]);
};

export default useBeforeUnload;
