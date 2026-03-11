import { Input, Popover } from "antd";
import type { ItemType, MenuItemType } from "antd/es/menu/interface";
import { useWkSelector } from "libs/react_hooks";
import { hexToRgb, rgbToHex } from "libs/utils";
import type React from "react";
import type { MouseEvent } from "react";
import { useDispatch } from "react-redux";
import type { Vector3 } from "viewer/constants";
import { isRotated } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { maybeGetSomeTracing } from "viewer/model/accessors/tracing_accessor";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import { setActiveUserBoundingBoxId } from "viewer/model/actions/ui_actions";
import type { ContextMenuInfo } from "viewer/store";
import { shortcutBuilder } from "./helpers";
import { hideContextMenu, useContextMenuActions } from "./use_context_menu_actions";

export function useBoundingBoxMenuOptions(contextInfo: ContextMenuInfo): ItemType[] {
  const { globalPosition, clickedBoundingBoxId } = contextInfo;

  const activeTool = useWkSelector((state) => state.uiInformation.activeTool);
  const userBoundingBoxes = useWkSelector((state) => {
    const someTracing = maybeGetSomeTracing(state.annotation);
    return someTracing != null ? someTracing.userBoundingBoxes : [];
  });
  const allowUpdate = useWkSelector((state) => state.annotation.isUpdatingCurrentlyAllowed);
  const isFlycamRotated = useWkSelector((state) => isRotated(state.flycam));

  const dispatch = useDispatch();
  const actions = useContextMenuActions();

  if (globalPosition == null) return [];

  const isBoundingBoxToolActive = activeTool === AnnotationTool.BOUNDING_BOX;
  const newBoundingBoxMenuItem: ItemType = {
    key: "add-new-bounding-box",
    onClick: () => {
      dispatch(addUserBoundingBoxAction(null, globalPosition));
    },
    label: (
      <>
        Create new Bounding Box
        {isBoundingBoxToolActive ? shortcutBuilder(["C"]) : null}
      </>
    ),
    disabled: isFlycamRotated,
    title: isFlycamRotated ? "Not available while view is rotated." : undefined,
  };

  if (!allowUpdate && clickedBoundingBoxId != null) {
    const hideBoundingBoxMenuItem: MenuItemType = {
      key: "hide-bounding-box",
      onClick: () => {
        actions.hideBoundingBox(clickedBoundingBoxId);
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
    actions.setBoundingBoxName(clickedBoundingBoxId, value);
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
      onClick: () => dispatch(setActiveUserBoundingBoxId(hoveredBBox.id)),
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
              actions.setBoundingBoxColor(clickedBoundingBoxId, color);
            }}
            value={rgbToHex(upscaledBBoxColor)}
          />
        </span>
      ),
    },
    {
      key: "hide-bounding-box",
      onClick: () => {
        actions.hideBoundingBox(clickedBoundingBoxId);
      },
      label: "Hide Bounding Box",
    },
    {
      key: "delete-bounding-box",
      onClick: () => {
        actions.deleteBoundingBox(clickedBoundingBoxId);
      },
      label: "Delete Bounding Box",
    },
  ];
}
