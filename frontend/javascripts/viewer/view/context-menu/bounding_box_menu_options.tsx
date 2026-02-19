import { Input, Popover } from "antd";
import type { ItemType, MenuItemType } from "antd/es/menu/interface";
import { hexToRgb, rgbToHex } from "libs/utils";
import type React from "react";
import type { MouseEvent } from "react";
import type { Vector3 } from "viewer/constants";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import { setActiveUserBoundingBoxId } from "viewer/model/actions/ui_actions";
import Store from "viewer/store";
import { Actions, hideContextMenu } from "./context_menu_actions";
import { shortcutBuilder } from "./helpers";
import type { NoNodeContextMenuProps } from "./types";

export function getBoundingBoxMenuOptions({
  contextInfo,
  activeTool,
  userBoundingBoxes,
  allowUpdate,
  isRotated,
}: NoNodeContextMenuProps): ItemType[] {
  const { globalPosition, clickedBoundingBoxId } = contextInfo;
  if (globalPosition == null) return [];

  const isBoundingBoxToolActive = activeTool === AnnotationTool.BOUNDING_BOX;
  const newBoundingBoxMenuItem: ItemType = {
    key: "add-new-bounding-box",
    onClick: () => {
      Store.dispatch(addUserBoundingBoxAction(null, globalPosition));
    },
    label: (
      <>
        Create new Bounding Box
        {isBoundingBoxToolActive ? shortcutBuilder(["C"]) : null}
      </>
    ),
    disabled: isRotated,
    title: isRotated ? "Not available while view is rotated." : undefined,
  };

  if (!allowUpdate && clickedBoundingBoxId != null) {
    const hideBoundingBoxMenuItem: MenuItemType = {
      key: "hide-bounding-box",
      onClick: () => {
        Actions.hideBoundingBox(Store.dispatch, clickedBoundingBoxId);
      },
      label: "Hide Bounding Box",
    };
    return [hideBoundingBoxMenuItem];
  }

  if (!allowUpdate) {
    return [];
  }

  if (clickedBoundingBoxId == null) {
    return [newBoundingBoxMenuItem];
  }

  const hoveredBBox = userBoundingBoxes.find((bbox) => bbox.id === clickedBoundingBoxId);

  if (hoveredBBox == null) {
    return [newBoundingBoxMenuItem];
  }

  const setBBoxName = (evt: React.SyntheticEvent) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
    const value = evt.target.value;
    Actions.setBoundingBoxName(Store.dispatch, clickedBoundingBoxId, value);
  };

  const preventContextMenuFromClosing = (evt: MouseEvent) => {
    evt.stopPropagation();
  };

  const upscaledBBoxColor = hoveredBBox.color.map((colorPart) => colorPart * 255) as any as Vector3;

  return [
    newBoundingBoxMenuItem,
    {
      key: "focus-in-bbox-tab",
      label: "Focus in Bounding Box Tab",
      onClick: () => Store.dispatch(setActiveUserBoundingBoxId(hoveredBBox.id)),
    },
    {
      key: "change-bounding-box-name",
      label: (
        <Popover
          title="Set Bounding Box Name"
          content={
            <Input
              defaultValue={hoveredBBox.name}
              placeholder="Bounding Box Name"
              size="small"
              onPressEnter={(evt) => {
                setBBoxName(evt);
                hideContextMenu();
              }}
              onBlur={setBBoxName}
              onClick={preventContextMenuFromClosing}
            />
          }
          trigger="click"
        >
          <span
            onClick={preventContextMenuFromClosing}
            style={{
              width: "100%",
              display: "inline-block",
            }}
          >
            Change Bounding Box Name
          </span>
        </Popover>
      ),
    },
    {
      key: "change-bounding-box-color",
      label: (
        <span
          onClick={preventContextMenuFromClosing}
          style={{
            width: "100%",
            display: "inline-block",
            position: "relative",
          }}
        >
          Change Bounding Box Color
          <input
            type="color"
            style={{
              display: "inline-block",
              border: "none",
              cursor: "pointer",
              width: "100%",
              height: "100%",
              position: "absolute",
              left: 0,
              top: 0,
              opacity: 0,
            }}
            onChange={(evt: React.ChangeEvent<HTMLInputElement>) => {
              let color = hexToRgb(evt.target.value);
              color = color.map((colorPart) => colorPart / 255) as any as Vector3;
              Actions.setBoundingBoxColor(Store.dispatch, clickedBoundingBoxId, color);
            }}
            value={rgbToHex(upscaledBBoxColor)}
          />
        </span>
      ),
    },
    {
      key: "hide-bounding-box",
      onClick: () => {
        Actions.hideBoundingBox(Store.dispatch, clickedBoundingBoxId);
      },
      label: "Hide Bounding Box",
    },
    {
      key: "delete-bounding-box",
      onClick: () => {
        Actions.deleteBoundingBox(Store.dispatch, clickedBoundingBoxId);
      },
      label: "Delete Bounding Box",
    },
  ];
}
