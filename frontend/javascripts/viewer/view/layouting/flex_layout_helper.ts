import { Actions, type BorderNode, type Model, type TabSetNode } from "flexlayout-react";
import { FlightViews } from "viewer/constants";
import type { BorderOpenStatus } from "viewer/store";
import type { ModelConfig } from "./flex_layout_types";

export function getMaximizedItemId(model: Model): string | null | undefined {
  const maximizedTabset = model.getMaximizedTabset();
  return maximizedTabset != null ? maximizedTabset.getId() : null;
}
// Determines which tabset should be toggled when the user presses the maximize shortcut.
// If a tabset is already maximized, it is restored. Otherwise, the tabset containing
// the hovered viewport is maximized (in flight/oblique mode this is the flight viewport).
// If no such tabset exists, the tabset with tab focus is used as a fallback.
export function getTabsetIdToToggleMaximize(
  model: Model,
  hoveredViewportId: string,
): string | null | undefined {
  const maximizedItemId = getMaximizedItemId(model);
  if (maximizedItemId != null) {
    return maximizedItemId;
  }

  for (const viewportId of [hoveredViewportId, FlightViews.flightViewport]) {
    const parent = model.getNodeById(viewportId)?.getParent();
    if (parent?.getType() === "tabset") {
      return parent.getId();
    }
  }

  return model.getActiveTabset()?.getId();
}

export function getBorderOpenStatus(model: Model): BorderOpenStatus {
  const openStatus = {
    left: false,
    right: false,
  };
  const borders = model.getBorderSet().getBorders();
  borders.forEach((border) => {
    const selectedNode = border.getSelectedNode();

    if (selectedNode != null) {
      openStatus[border.getLocation().getName() as "left" | "right"] = true;
    }
  });
  return openStatus;
}
export function adjustModelToBorderOpenStatus(model: Model, borderOpenStatus: BorderOpenStatus) {
  const borders = model.getBorderSet().getBorders();
  borders.forEach((border) => {
    const selectedNode = border.getSelectedNode();
    const side = border.getLocation().getName() as "left" | "right";

    if (
      (selectedNode != null && borderOpenStatus[side] === false) ||
      (selectedNode == null && borderOpenStatus[side] === true)
    ) {
      model.doAction(Actions.selectTab(`${side}-border-tab-container`));
    }
  });
}
type NodePositionStatus = {
  isTopMost: boolean;
  isLeftMost: boolean;
  isRightMost: boolean;
};
export function getPositionStatusOf(tabSetNode: TabSetNode | BorderNode): NodePositionStatus {
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

  const rootContainerRect = tabSetNode.getModel().getRoot().getRect();
  // Comparing the left and right side of the tabSetNode with the left and right side
  // of the root container that contains everything except for the borders.
  isLeftMost = tabSetNodeRect.x === rootContainerRect.x;
  isRightMost =
    Math.trunc(tabSetNodeRect.x + tabSetNodeRect.width) ===
    Math.trunc(rootContainerRect.x + rootContainerRect.width);
  return {
    isTopMost,
    isLeftMost,
    isRightMost,
  };
}

// Checking whether the TDViewport is maximized in the layout config via
// searching for the td viewport component in the json config.
export function is3dViewportMaximized(modelConfig: ModelConfig) {
  return modelConfig.layout.children.some((child) => {
    return (
      child.type === "row" &&
      child.children.some((rowChild) => {
        return (
          rowChild.type === "tabset" &&
          rowChild.maximized &&
          rowChild.children?.[0]?.id === "TDView"
        );
      })
    );
  });
}
