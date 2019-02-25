// @flow

import window from "libs/window";
import Store from "oxalis/store";

function getOrganization() {
  const { activeUser } = Store.getState();
  return activeUser != null ? activeUser.organization : null;
}

function gaGuard(...params) {
  console.log("GA", ...params);
  if (typeof window.ga !== "undefined" && window.ga !== null) {
    window.ga(...params);
  }
}

// The void return type is needed for flow to check successfully
export function trackAction(action: string): void {
  gaGuard("send", "event", "Action", action, getOrganization());
}

export function trackVersion(version: string): void {
  gaGuard("send", {
    hitType: "event",
    eventCategory: "pageLoad",
    eventAction: "version",
    eventLabel: version,
  });
}

export function googleAnalyticsLogClicks(evt: MouseEvent) {
  // This function logs all clicks on elements that contain text to google analytics

  // Flow doesn't allow to check for the textContent property otherwise
  const target = ((evt.target: any): Node);
  if (target.textContent != null) {
    // Restrict the textContent to a maximum length
    const textContent = target.textContent.trim().slice(0, 50);
    if (textContent.length > 0) {
      gaGuard("send", "event", "Click", textContent, getOrganization());
    }
  }
}

export default {};
