// @flow
import { Model, Actions } from "flexlayout-react";
import type { BorderOpenStatus } from "oxalis/store";

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

export function adjustModelToBorderOpenStatus(
  model: typeof Model,
  borderOpenStatus: BorderOpenStatus,
) {
  const borders = model.getBorderSet().getBorders();
  borders.forEach(border => {
    const selectedNode = border.getSelectedNode();
    const side = border.getLocation().getName();
    if (
      (selectedNode != null && borderOpenStatus[side] === false) ||
      (selectedNode == null && borderOpenStatus[side] === true)
    ) {
      model.doAction(Actions.selectTab(`${side}-border-tab-container`));
    }
  });
}

export function getBorderWidths(model: typeof Model) {
  const borderWidths = { left: 0, right: 0 };
  const borders = model.getBorderSet().getBorders();
  borders.forEach(border => {
    const size = border.getSize();
    const side = border.getLocation().getName();
    const isCollapsed = border.getSelectedNode() == null;
    borderWidths[side] = isCollapsed ? 0 : size;
  });
  return borderWidths;
}
