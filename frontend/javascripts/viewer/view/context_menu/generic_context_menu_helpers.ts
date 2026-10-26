import type { MenuProps } from "antd";
import type React from "react";

// These helpers are also used outside of the viewer (e.g., for the dataset table's context menu),
// which is why they don't live in ./helpers, which depends on the viewer's code.

export const getNoActionsAvailableMenu = (hideContextMenu: () => void): MenuProps => ({
  onClick: hideContextMenu,
  style: {
    borderRadius: 6,
  },
  mode: "vertical",
  items: [
    {
      key: "view",
      disabled: true,
      title: "No actions available.",
    },
  ],
});

export function getContextMenuPositionFromEvent(
  event: React.MouseEvent<HTMLElement>,
  className: string,
): [number, number] {
  const overlayDivs = document.getElementsByClassName(className);
  const referenceDiv = Array.from(overlayDivs)
    .map((p) => p.parentElement)
    .find((potentialParent) => {
      if (potentialParent == null) {
        return false;
      }
      const bounds = potentialParent.getBoundingClientRect();
      return bounds.width > 0;
    });

  if (referenceDiv == null) {
    return [0, 0];
  }
  const bounds = referenceDiv.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  return [x, y];
}
