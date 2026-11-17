import type React from "react";

// Elements within a dashboard list row that have their own click action.
const INTERACTIVE_ELEMENTS_SELECTOR =
  "a, button, input, textarea, label, .ant-tag, .ant-dropdown-trigger, [role='button']";

/**
 * Returns whether a click on a dashboard list row should (de)select the row. Clicks on
 * interactive elements within the row (e.g., links or tags) shouldn't, as this would cause two
 * actions at once. Clicks on plain content (e.g., the meta text) should, so that tapping anywhere
 * on a row opens its details on touch devices.
 */
export function isRowSelectionClick(event: React.MouseEvent<HTMLElement>): boolean {
  const { target, currentTarget } = event;
  // React also bubbles events from portals (e.g., a modal opened from within the row) to the row.
  if (!(target instanceof Element) || !currentTarget.contains(target)) {
    return false;
  }
  const interactiveElement = target.closest(INTERACTIVE_ELEMENTS_SELECTOR);
  return interactiveElement == null || !currentTarget.contains(interactiveElement);
}
