import { Model, Actions, TabSetNode } from "flexlayout-react";
import type { BorderOpenStatus } from "oxalis/store";
import "oxalis/store";
export function getMaximizedItemId(model: typeof Model): string | null | undefined {
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'getMaximizedTabset' does not exist on ty... Remove this comment to see the full error message
  const maximizedTabset = model.getMaximizedTabset();
  return maximizedTabset != null ? maximizedTabset.getId() : null;
}
export function getBorderOpenStatus(model: typeof Model): BorderOpenStatus {
  const openStatus = {
    left: false,
    right: false,
  };
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'getBorderSet' does not exist on type 'ty... Remove this comment to see the full error message
  const borders = model.getBorderSet().getBorders();
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'border' implicitly has an 'any' type.
  borders.forEach((border) => {
    const selectedNode = border.getSelectedNode();

    if (selectedNode != null) {
      // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      openStatus[border.getLocation().getName()] = true;
    }
  });
  return openStatus;
}
export function adjustModelToBorderOpenStatus(
  model: typeof Model,
  borderOpenStatus: BorderOpenStatus,
) {
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'getBorderSet' does not exist on type 'ty... Remove this comment to see the full error message
  const borders = model.getBorderSet().getBorders();
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'border' implicitly has an 'any' type.
  borders.forEach((border) => {
    const selectedNode = border.getSelectedNode();
    const side = border.getLocation().getName();

    if (
      // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      (selectedNode != null && borderOpenStatus[side] === false) ||
      // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      (selectedNode == null && borderOpenStatus[side] === true)
    ) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'doAction' does not exist on type 'typeof... Remove this comment to see the full error message
      model.doAction(Actions.selectTab(`${side}-border-tab-container`));
    }
  });
}
type NodePositionStatus = {
  isTopMost: boolean;
  isLeftMost: boolean;
  isRightMost: boolean;
};
export function getPositionStatusOf(tabSetNode: typeof TabSetNode): NodePositionStatus {
  // We have to determine whether the current tabset is part of the most upper tabsets directly below the header.
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'getRect' does not exist on type 'typeof ... Remove this comment to see the full error message
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

  // @ts-expect-error ts-migrate(2339) FIXME: Property 'getModel' does not exist on type 'typeof... Remove this comment to see the full error message
  const rootContainerRect = tabSetNode.getModel().getRoot().getRect();
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
