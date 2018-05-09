// @flow
import window from "libs/window";
import type { Dispatch } from "redux";

const blacklistedActionTypes = ["SET_MOUSE_POSITION"];

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
