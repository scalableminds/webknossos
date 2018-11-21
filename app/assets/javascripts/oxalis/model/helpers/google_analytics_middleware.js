// @flow
import type { Dispatch } from "redux";

import window from "libs/window";

const blacklistedActionTypes = ["SET_MOUSE_POSITION", "SET_VIEWPORT"];

export default function GoogleAnalyticsMiddleWare<A: $Subtype<{ type: $Subtype<string> }>>(): (
  next: Dispatch<A>,
) => Dispatch<A> {
  return (next: Dispatch<A>) => (action: A): A => {
    // Google Analytics
    if (typeof window.ga !== "undefined" && window.ga !== null) {
      if (!blacklistedActionTypes.includes(action.type)) {
        window.ga("send", "event", "ReduxAction", action.type);
      }
    }

    return next(action);
  };
}

export function googleAnalyticsLogClicks(evt: MouseEvent) {
  // This function logs all clicks on elements that contain text to google analytics
  if (typeof window.ga !== "undefined" && window.ga !== null) {
    // Flow doesn't allow to check for the textContent property otherwise
    const target = ((evt.target: any): Node);
    if (target.textContent != null) {
      // Restrict the textContent to a maximum length
      const textContent = target.textContent.trim().slice(0, 50);
      if (textContent.length > 0) {
        window.ga("send", "event", "Click", textContent);
      }
    }
  }
}
