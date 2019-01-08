// @flow

import window from "libs/window";
import Store from "oxalis/store";

export function trackAction(action: string) {
  if (typeof window.ga !== "undefined" && window.ga !== null) {
    const { activeUser } = Store.getState();
    const organization = activeUser != null ? activeUser.organization : null;
    window.ga("send", "event", "Action", action, organization);
  }
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

export default {};
