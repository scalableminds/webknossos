// @flow

import window from "libs/window";
import Store from "oxalis/store";

function getOrganization() {
  const { activeUser } = Store.getState();
  return activeUser != null ? activeUser.organization : null;
}

function gtagGuard(...params) {
  if (typeof window.gtag !== "undefined" && window.gtag !== null) {
    window.gtag(...params);
  }
}

// The void return type is needed for flow to check successfully
export function trackAction(action: string): void {
  gtagGuard("event", "action", action, getOrganization());
}

export function trackVersion(version: string): void {
  gtagGuard("event", "version", {
    event_category: "page_load",
    event_label: version,
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
      gtagGuard("event", "click", {
        event_category: textContent,
        event_label: getOrganization(),
      });
    }
  }
}

export default {};
