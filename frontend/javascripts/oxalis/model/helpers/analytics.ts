import window from "libs/window";
import Store from "oxalis/store";

function getOrganization() {
  const { activeUser } = Store.getState();
  return activeUser != null ? activeUser.organization : null;
}

// @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'params' implicitly has an 'any[]' ... Remove this comment to see the full error message
function gtagGuard(...params) {
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'gtag' does not exist on type '(Window & ... Remove this comment to see the full error message
  if (typeof window.gtag !== "undefined" && window.gtag !== null) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'gtag' does not exist on type '(Window & ... Remove this comment to see the full error message
    window.gtag(...params);
  }
}

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
  const target = evt.target as any as Node;

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
