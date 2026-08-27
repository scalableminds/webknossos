import Icon, { FileTextOutlined } from "@ant-design/icons";
import IconStatusbarMouseLeft from "@images/icons/icon-statusbar-mouse-left.svg?react";
import IconStatusbarMouseLeftDrag from "@images/icons/icon-statusbar-mouse-left-drag.svg?react";
import IconStatusbarMouseRight from "@images/icons/icon-statusbar-mouse-right.svg?react";
import IconStatusbarMouseRightDrag from "@images/icons/icon-statusbar-mouse-right-drag.svg?react";
import IconStatusbarMouseWheel from "@images/icons/icon-statusbar-mouse-wheel.svg?react";
import { Popover, Space, Typography } from "antd";
import { useKeyPress, useWkSelector } from "libs/react_hooks";
import React from "react";
import { AltOrOptionKey, OrthoViews } from "viewer/constants";
import {
  type ActionDescriptor,
  getToolControllerForAnnotationTool,
} from "viewer/controller/combinations/tool_controls";
import { AnnotationTool, adaptActiveToolToShortcuts } from "viewer/model/accessors/tool_accessor";
import { isPlaneMode as getIsPlaneMode } from "viewer/model/accessors/view_mode_accessor";

const { Text } = Typography;

const lineColor = "rgba(255, 255, 255, 0.67)";
const moreIconStyle = {
  height: 14,
  color: lineColor,
};

export type ShortcutItem = {
  key: string;
  node: React.ReactNode;
};

function getZoomShortcutItem(): ShortcutItem {
  return {
    key: "zoom",
    node: (
      <span className="shortcut-info-element">
        <Text keyboard>{AltOrOptionKey}</Text>
        +
        <Icon component={IconStatusbarMouseWheel} aria-label="Mouse Wheel" /> Zoom in/out
      </span>
    ),
  };
}

function getLeftClickItems(actionDescriptor: ActionDescriptor): ShortcutItem[] {
  const items: ShortcutItem[] = [];
  if (actionDescriptor.leftClick != null) {
    items.push({
      key: "left-click",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon component={IconStatusbarMouseLeft} aria-label="Mouse Left Click" />
          {actionDescriptor.leftClick}
        </Space>
      ),
    });
  }
  if (actionDescriptor.leftDrag != null) {
    items.push({
      key: "left-drag",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon
            className="statusbar-drag-icon"
            component={IconStatusbarMouseLeftDrag}
            aria-label="Mouse Left Drag"
          />
          {actionDescriptor.leftDrag}
        </Space>
      ),
    });
  }
  return items;
}

function getRightClickItems(actionDescriptor: ActionDescriptor): ShortcutItem[] {
  const items: ShortcutItem[] = [];
  if (actionDescriptor.rightClick != null) {
    items.push({
      key: "right-click",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon component={IconStatusbarMouseRight} aria-label="Mouse Right Click" />
          {actionDescriptor.rightClick}
        </Space>
      ),
    });
  }
  if (actionDescriptor.rightDrag != null) {
    items.push({
      key: "right-drag",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon
            className="statusbar-drag-icon"
            component={IconStatusbarMouseRightDrag}
            aria-label="Mouse Right Drag"
          />
          {actionDescriptor.rightDrag}
        </Space>
      ),
    });
  }
  return items;
}

function getMoreShortcutsItems(): ShortcutItem[] {
  return [
    {
      key: "commands",
      node: (
        <div className="shortcut-info-element">
          <Text keyboard>Ctrl + P</Text> Commands
        </div>
      ),
    },
    {
      key: "more-link",
      node: moreShortcutsLink,
    },
  ];
}

// Note: this item's spacing (and that of the "commands" item above) relies on the
// scoped `.statusbar .shortcut-info-element` CSS rule, which only applies to elements
// that are actual DOM descendants of `.statusbar`. When shown inside the "More" popover
// (which antd renders into a portal outside of `.statusbar`), that rule doesn't apply,
// so these items render flush-left there instead of picking up stray margin.
const moreShortcutsLink = (
  <a
    target="_blank"
    href="https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html"
    rel="noopener noreferrer"
    className="shortcut-info-element statusbar-doc-link"
  >
    <FileTextOutlined style={moreIconStyle} /> Shortcut Documentation
  </a>
);

export function useShortcutItems(): ShortcutItem[] {
  /* Exposes shortcut/control hints that are shown in the status bar (left side) */
  const activeTool = useWkSelector((state) => state.uiInformation.activeTool);
  const userConfiguration = useWkSelector((state) => state.userConfiguration);
  const isPlaneMode = useWkSelector((state) => getIsPlaneMode(state));
  const isShiftPressed = useKeyPress("Shift");
  const isControlOrMetaPressed = useKeyPress("ControlOrMeta");
  const isAltPressed = useKeyPress("Alt");
  const hasSkeleton = useWkSelector((state) => state.annotation.skeleton != null);
  const isTDViewportActive = useWkSelector(
    (state) => state.viewModeData.plane.activeViewport === OrthoViews.TDView,
  );

  if (!isPlaneMode) {
    let actionDescriptor: ActionDescriptor | null = null;
    if (hasSkeleton && isShiftPressed) {
      actionDescriptor = getToolControllerForAnnotationTool(
        AnnotationTool.SKELETON,
      ).getActionDescriptors(
        AnnotationTool.SKELETON,
        userConfiguration,
        isShiftPressed,
        isControlOrMetaPressed,
        isAltPressed,
        isTDViewportActive,
      );
    }

    const items: ShortcutItem[] =
      actionDescriptor != null
        ? getLeftClickItems(actionDescriptor)
        : [
            {
              key: "move",
              node: (
                <span className="shortcut-info-element">
                  <Icon
                    className="statusbar-drag-icon"
                    component={IconStatusbarMouseLeftDrag}
                    aria-label="Mouse Left Drag"
                  />
                  Move
                </span>
              ),
            },
          ];
    items.push(
      {
        key: "trace-forward",
        node: (
          <Space size="small" className="shortcut-info-element">
            <Text keyboard>Space</Text>
            Trace forward
          </Space>
        ),
      },
      {
        key: "trace-backward",
        node: (
          <Space size="small" className="shortcut-info-element">
            <Text keyboard>Ctrl + Space</Text>
            Trace backward
          </Space>
        ),
      },
      {
        key: "rotation",
        node: (
          <Space size="small" className="shortcut-info-element">
            <Text keyboard>◀ / ▶</Text>
            Rotation
          </Space>
        ),
      },
      ...getMoreShortcutsItems(),
    );
    return items;
  }

  const adaptedTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlOrMetaPressed,
    isAltPressed,
  );
  const toolController = getToolControllerForAnnotationTool(adaptedTool);
  const actionDescriptor = toolController.getActionDescriptors(
    adaptedTool,
    userConfiguration,
    isShiftPressed,
    isControlOrMetaPressed,
    isAltPressed,
    isTDViewportActive,
  );

  return [
    ...getLeftClickItems(actionDescriptor),
    ...getRightClickItems(actionDescriptor),
    {
      key: "wheel",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon component={IconStatusbarMouseWheel} aria-label="Mouse Wheel" />
          {isAltPressed || isControlOrMetaPressed ? "Zoom in/out" : "Move along 3rd axis"}
        </Space>
      ),
    },
    {
      key: "rotate-3d",
      node: (
        <Space size="small" className="shortcut-info-element">
          <Icon
            className="statusbar-drag-icon"
            component={IconStatusbarMouseRightDrag}
            aria-label="Mouse Right"
          />
          Rotate 3D View
        </Space>
      ),
    },
    getZoomShortcutItem(),
    ...getMoreShortcutsItems(),
  ];
}

// forwardRef (and spreading ...props) is required here because antd's Popover clones
// its child to inject the click handler and a positioning ref directly onto it -- a
// plain function component would silently drop both, leaving the trigger unclickable.
export const MoreButtonLabel = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { label: string }
>(({ label, ...props }, ref) => (
  <span {...props} ref={ref} className="shortcut-info-element" style={{ cursor: "pointer" }}>
    <FileTextOutlined /> {label}
  </span>
));
MoreButtonLabel.displayName = "MoreButtonLabel";

// "More" implies there's something in addition to what's already visible, which is
// misleading once every hint has been hidden -- in that case, the trigger IS the only
// way to reach the hints, so it's labeled to describe its content instead.
export const MORE_LABEL = "More";
export const ALL_HIDDEN_LABEL = "Controls";

export function MoreShortcutsButton({
  hiddenItems,
  allHidden,
}: {
  hiddenItems: ShortcutItem[];
  allHidden: boolean;
}) {
  return (
    <Popover
      trigger="click"
      placement="top"
      content={
        <div
          className="statusbar-overflow-content"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxWidth: 280,
          }}
        >
          {hiddenItems.map((item) => (
            <React.Fragment key={item.key}>{item.node}</React.Fragment>
          ))}
        </div>
      }
    >
      <MoreButtonLabel label={allHidden ? ALL_HIDDEN_LABEL : MORE_LABEL} />
    </Popover>
  );
}
