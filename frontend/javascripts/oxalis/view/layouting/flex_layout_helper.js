// @flow
// TODO: Better use the models interface for this

// TODO: Rename each sidebar to border
import { Model } from "flexlayout-react";

export type BorderOpenStatus = {
  left: boolean,
  right: boolean,
};

export function getMaximizedItemId(model: typeof Model): ?string {
  const maximizedTabset = model.getMaximizedTabset();
  return maximizedTabset != null ? maximizedTabset.getId() : null;
}

export function getBorderOpenStatus(model: typeof Model): BorderOpenStatus {
  const openStatus = { left: false, right: false };
  const borders = model.getBorderSet().getBorders();
  borders.forEach(border => {
    const selectedNode = border.getSelectedNode();
    if (selectedNode != null) {
      openStatus[border.getLocation().getName()] = true;
    }
  });
  return openStatus;
}
