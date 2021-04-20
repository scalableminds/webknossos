// @flow
import { Model, Actions, TabSetNode } from "flexlayout-react";
import Store, { type BorderOpenStatus } from "oxalis/store";
import { defaultSplitterSize, borderBarSize } from "./default_layout_configs";

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

type NodePositionStatus = {
  isTopMost: boolean,
  isLeftMost: boolean,
  isRightMost: boolean,
};

export function getPositionStatusOf(tabSetNode: typeof TabSetNode): NodePositionStatus {
  // We have to determine whether the current tabset is part of the most upper tabsets directly below the header.
  const rect = tabSetNode.getRect();
  const isTopMost = rect.y === 0;
  let isLeftMost = false;
  let isRightMost = false;
  if (!isTopMost) {
    // In this case we do not need to calculate the other position booleans.
    return { isTopMost, isLeftMost, isRightMost };
  }
  const borders = { left: null, right: null };
  tabSetNode
    .getModel()
    .getBorderSet()
    .getBorders()
    .forEach(border => {
      const side = border.getLocation().getName();
      borders[side] = border;
    });
  const currentBorderOpenStatus = Store.getState().uiInformation.borderOpenStatus;

  if (borders.left != null) {
    if (currentBorderOpenStatus.left) {
      const { x: leftBorderX, width: leftBorderWidth } = borders.left.getContentRect();
      isLeftMost = rect.x === leftBorderX + leftBorderWidth + defaultSplitterSize;
    } else {
      isLeftMost = rect.x === 0 + borderBarSize;
    }
  }
  if (borders.right != null) {
    if (currentBorderOpenStatus.right) {
      const { x: rightBorderX } = borders.right.getContentRect();
      isRightMost = rect.x + rect.width + defaultSplitterSize === rightBorderX;
    } else {
      // No need to add defaultSplitterSize as the border is hidden and thus there is no splitter.
      isRightMost = rect.x + rect.width === window.screen.width - borderBarSize;
    }
  }
  return { isTopMost, isLeftMost, isRightMost };
}
