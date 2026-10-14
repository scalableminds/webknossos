import { useEffect, useRef } from "react";
import { useBlocker } from "react-router";

const LEAVE_PROMPT_MESSAGE = "The landmarks have unsaved changes that may be lost. Leave anyway?";

/** Asks before leaving the page while the layer registration annotation has unsaved changes.
 * This can't be left to the store iframe, although it has the normal "unsaved changes" check
 * of the viewer: browsers only show the "leave page?" dialog for a frame that the user
 * interacted with, and nobody interacts with the hidden store iframe. The user's clicks in the
 * workers count as interaction with this page, though.
 * Returns a function that turns the prompt off for navigations that the page starts itself.
 */
export function useLeavePrompt(hasUnsavedChanges: boolean): () => void {
  const isLeavingRef = useRef(false);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need returnValue to be set to show the dialog.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  // Navigation within the app (e.g. with the browser's back button) doesn't fire
  // "beforeunload".
  const blocker = useBlocker(
    () => !isLeavingRef.current && hasUnsavedChanges && !confirm(LEAVE_PROMPT_MESSAGE),
  );
  useEffect(() => {
    // The user chose to stay, so the next navigation must be checked again.
    if (blocker.state === "blocked") {
      blocker.reset();
    }
  }, [blocker]);

  return () => {
    isLeavingRef.current = true;
  };
}
