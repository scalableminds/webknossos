import Icon from "@ant-design/icons";
import RulerIcon from "@images/icons/icon-ruler.svg?react";
import IconStatusbarMouseLeft from "@images/icons/icon-statusbar-mouse-left.svg?react";
import IconStatusbarMouseRight from "@images/icons/icon-statusbar-mouse-right.svg?react";
import IconStatusbarMouseWheel from "@images/icons/icon-statusbar-mouse-wheel.svg?react";
import { type MenuProps, notification } from "antd";
import type { MenuItemGroupType, MenuItemType } from "antd/es/menu/interface";
import { formatLengthAsVx, formatNumberToLength } from "libs/format_utils";
import { roundTo } from "libs/utils";
import messages from "messages";
import React from "react";
import type { AdditionalCoordinate } from "types/api_types";
import { LongUnitToShortUnitMap, type UnitLong, type Vector3 } from "viewer/constants";
import { addTreesAndGroupsAction } from "viewer/model/actions/skeletontracing_actions";
import { extractPathAsNewTree } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import { type Tree, TreeMap } from "viewer/model/types/tree_types";
import { api } from "viewer/singletons";
import Store from "viewer/store";

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

export function measureAndShowLengthBetweenNodes(
  sourceNodeId: number,
  targetNodeId: number,
  voxelSizeUnit: UnitLong,
) {
  const [lengthInUnit, lengthInVx] = api.tracing.measurePathLengthBetweenNodes(
    sourceNodeId,
    targetNodeId,
  );
  notification.open({
    title: `The shortest path length between the nodes is ${formatNumberToLength(
      lengthInUnit,
      LongUnitToShortUnitMap[voxelSizeUnit],
    )} (${formatLengthAsVx(lengthInVx)}).`,
    icon: <Icon component={RulerIcon} />,
  });
}

export function extractShortestPathAsNewTree(
  sourceTree: Tree,
  sourceNodeId: number,
  targetNodeId: number,
) {
  const { shortestPath } = api.tracing.findShortestPathBetweenNodes(sourceNodeId, targetNodeId);
  const newTree = extractPathAsNewTree(Store.getState(), sourceTree, shortestPath);
  if (newTree != null) {
    const treeMap = new TreeMap([[newTree.treeId, newTree]]);
    Store.dispatch(addTreesAndGroupsAction(treeMap, null));
  }
}

export function measureAndShowFullTreeLength(
  treeId: number,
  treeName: string,
  voxelSizeUnit: UnitLong,
) {
  const [lengthInUnit, lengthInVx] = api.tracing.measureTreeLength(treeId);
  notification.open({
    title: messages["tracing.tree_length_notification"](
      treeName,
      formatNumberToLength(lengthInUnit, LongUnitToShortUnitMap[voxelSizeUnit]),
      formatLengthAsVx(lengthInVx),
    ),
    icon: <Icon component={RulerIcon} />,
  });
}

export function positionToString(
  pos: Vector3,
  optAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
): string {
  const additionalCoordinates = (optAdditionalCoordinates || []).map((coord) => coord.value);
  return [...pos, ...additionalCoordinates].map((value) => roundTo(value, 2)).join(", ");
}

export function shortcutBuilder(shortcuts: Array<string>): React.ReactNode {
  const lineColor = "var(--ant-color-text-secondary)";
  const mouseIconStyle = { margin: 0, marginLeft: -2, height: 18 };

  const mapNameToShortcutIcon = (name: string) => {
    switch (name) {
      case "leftMouse": {
        return (
          <Icon
            component={IconStatusbarMouseLeft}
            aria-label="Mouse Left Click"
            style={mouseIconStyle}
          />
        );
      }

      case "rightMouse": {
        return (
          <Icon
            component={IconStatusbarMouseRight}
            aria-label="Mouse Right Click"
            style={mouseIconStyle}
          />
        );
      }

      case "middleMouse": {
        return (
          <Icon
            component={IconStatusbarMouseWheel}
            aria-label="Mouse Wheel"
            style={mouseIconStyle}
          />
        );
      }

      default: {
        return (
          <span
            className="keyboard-key-icon-small"
            style={{
              borderColor: lineColor,
            }}
          >
            {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
            <span
              style={{
                position: "relative",
                top: -9,
              }}
            >
              {name}
            </span>
          </span>
        );
      }
    }
  };

  return (
    <span
      style={{
        float: "right",
        color: lineColor,
        marginLeft: 10,
      }}
    >
      {shortcuts.map((name, index) => (
        <React.Fragment key={name}>
          {mapNameToShortcutIcon(name)}
          {index < shortcuts.length - 1 ? " + " : null}
        </React.Fragment>
      ))}
    </span>
  );
}

export function getInfoMenuItem(
  key: MenuItemType["key"],
  label: MenuItemType["label"],
): MenuItemGroupType {
  /*
   * This component is a work-around. We want antd menu entries that can not be selected
   * or otherwise interacted with. An "empty" menu group will only display the group header
   * which gives us the desired behavior.
   */

  return { key, label, type: "group" };
}

export function getContextMenuPositionFromEvent(
  event: React.MouseEvent<HTMLDivElement>,
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
