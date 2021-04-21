// @flow
import { Model, Actions, TabSetNode } from "flexlayout-react";
import { type BorderOpenStatus } from "oxalis/store";

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
  const tabSetNodeRect = tabSetNode.getRect();
  const isTopMost = tabSetNodeRect.y === 0;
  let isLeftMost = false;
  let isRightMost = false;
  if (!isTopMost) {
    // In this case we do not need to calculate the other position booleans.
    return {
      isTopMost,
      isLeftMost,
      isRightMost,
    };
  }

  const rootContainerRect = tabSetNode
    .getModel()
    .getRoot()
    .getRect();

  // Comparing the left and right side of the tabSetNode with the left and right side
  // of the root container that contains everything except for the borders.
  isLeftMost = tabSetNodeRect.x === rootContainerRect.x;
  isRightMost =
    tabSetNodeRect.x + tabSetNodeRect.width === rootContainerRect.x + rootContainerRect.width;
  return {
    isTopMost,
    isLeftMost,
    isRightMost,
  };
}
