// @flow
import { Space, Tooltip } from "antd";

import { useDispatch, useSelector } from "react-redux";

import React from "react";

import { WarningOutlined, MoreOutlined } from "@ant-design/icons";

import { type Vector3, OrthoViews } from "oxalis/constants";
import { getSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import { NumberInputPopoverSetting } from "oxalis/view/components/setting_input_views";

import { useKeyPress } from "libs/react_hooks";
import Store from "oxalis/store";

import { getCurrentResolution } from "oxalis/model/accessors/flycam_accessor";

import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import {
  setActiveNodeAction,
  setActiveTreeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import message from "messages";

import { getToolClassForAnnotationTool } from "oxalis/controller/combinations/tool_controls";
import {
  calculateGlobalPos,
  isPlaneMode as getIsPlaneMode,
} from "oxalis/model/accessors/view_mode_accessor";
import { adaptActiveToolToShortcuts } from "oxalis/model/accessors/tool_accessor";
import { V3 } from "libs/mjs";
import Model from "oxalis/model";

const spaceBetweenItems = 25;
const lineColor = "rgba(255, 255, 255, 0.67)";

const defaultShortcutStyle = { marginLeft: spaceBetweenItems };
const spaceStyle = { display: "flex", flexWrap: "wrap" };
const moreIconStyle = { height: 14, color: lineColor };
const moreLinkStyle = { marginLeft: 10 };

const hasSegmentation = () => Model.getSegmentationLayer() != null;

function getPosString(pos: Vector3) {
  return V3.floor(pos).join(",");
}

function ZoomShortcut() {
  return (
    <span key="zoom" style={defaultShortcutStyle}>
      <span
        key="zoom-i"
        className="keyboard-key-icon-small"
        style={{ borderColor: lineColor, marginTop: -1 }}
      >
        {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
        <span style={{ position: "relative", top: -2 }}>Alt</span>
      </span>{" "}
      +
      <img
        className="keyboard-mouse-icon"
        src="/assets/images/icon-statusbar-mouse-wheel.svg"
        alt="Mouse Wheel"
      />
      Zoom in/out
    </span>
  );
}

function LeftClickShortcut({ actionInfos }) {
  const leftClick =
    actionInfos.leftClick != null ? (
      <span style={defaultShortcutStyle}>
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-left.svg"
          alt="Mouse Left Click"
        />
        {actionInfos.leftClick}
      </span>
    ) : null;

  const leftDrag =
    actionInfos.leftDrag != null ? (
      <span style={defaultShortcutStyle}>
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-left-drag.svg"
          alt="Mouse Left Drag"
        />
        {actionInfos.leftDrag}
      </span>
    ) : null;

  return (
    <div style={{ display: "inline-block", marginLeft: "auto" }}>
      {leftClick}
      {leftDrag}
    </div>
  );
}

function RightClickShortcut({ actionInfos }) {
  const rightClick =
    actionInfos.rightClick != null ? (
      <span style={defaultShortcutStyle}>
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-right.svg"
          alt="Mouse Right Click"
        />
        {actionInfos.rightClick}
      </span>
    ) : null;

  const rightDrag =
    actionInfos.rightDrag != null ? (
      <span style={defaultShortcutStyle}>
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-right-drag.svg"
          alt="Mouse Right Drag"
        />
        {actionInfos.rightDrag}
      </span>
    ) : null;

  return (
    <React.Fragment>
      {rightClick}
      {rightDrag}
    </React.Fragment>
  );
}

function ShortcutsInfo() {
  const activeTool = useSelector(state => state.uiInformation.activeTool);
  const useLegacyBindings = useSelector(state => state.userConfiguration.useLegacyBindings);
  const isPlaneMode = useSelector(state => getIsPlaneMode(state));

  const isShiftPressed = useKeyPress("Shift");
  const isControlPressed = useKeyPress("Control");
  const isAltPressed = useKeyPress("Alt");

  const adaptedTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlPressed,
    isAltPressed,
  );
  const actionInfos = getToolClassForAnnotationTool(adaptedTool).getActionDescriptors(
    adaptedTool,
    useLegacyBindings,
    isShiftPressed,
    isControlPressed,
    isAltPressed,
  );

  const moreShortcutsLink = (
    <a
      target="_blank"
      href="https://docs.webknossos.org/reference/keyboard_shortcuts"
      rel="noopener noreferrer"
      style={moreLinkStyle}
    >
      <Tooltip title="More Shortcuts">
        <MoreOutlined rotate={90} style={moreIconStyle} />
      </Tooltip>
    </a>
  );
  if (!isPlaneMode) {
    return (
      <React.Fragment>
        <span
          style={{
            marginLeft: "auto",
            textTransform: "capitalize",
          }}
        >
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-left-drag.svg"
            alt="Mouse Left Drag"
          />
          Move
        </span>
        <span key="zoom" style={defaultShortcutStyle}>
          <span
            key="zoom-i"
            className="keyboard-key-icon-small"
            style={{ borderColor: lineColor, marginTop: -1 }}
          >
            {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
            <span style={{ position: "relative", top: -2 }}>Space</span>
          </span>{" "}
          Trace forward
        </span>
        {moreShortcutsLink}
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <LeftClickShortcut actionInfos={actionInfos} />
      <RightClickShortcut actionInfos={actionInfos} />
      <span style={defaultShortcutStyle}>
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-wheel.svg"
          alt="Mouse Wheel"
        />
        {isAltPressed || isControlPressed ? "Zoom in/out" : "Move along 3rd axis"}
      </span>
      <span style={defaultShortcutStyle}>
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-right-drag.svg"
          alt="Mouse Right"
        />
        Rotate 3D View
      </span>
      <ZoomShortcut />
      {moreShortcutsLink}
    </React.Fragment>
  );
}

function getCellInfo(globalMousePosition: ?Vector3) {
  if (!hasSegmentation()) return null;

  const getSegmentIdString = () => {
    const hoveredCellInfo = Model.getHoveredCellId(globalMousePosition);
    if (!hoveredCellInfo) {
      return "-";
    }
    return hoveredCellInfo.isMapped ? `${hoveredCellInfo.id} (mapped)` : hoveredCellInfo.id;
  };

  return (
    <span className="info-element" style={{ minWidth: 140 }}>
      Segment {getSegmentIdString()}
    </span>
  );
}

function maybeLabelWithSegmentationWarning(hasUint64Segmentation: boolean, label: string) {
  return hasUint64Segmentation ? (
    <React.Fragment>
      {label}{" "}
      <Tooltip title={message["tracing.uint64_segmentation_warning"]}>
        <WarningOutlined style={{ color: "var(--ant-warning)" }} />
      </Tooltip>
    </React.Fragment>
  ) : (
    label
  );
}
function Infos() {
  const activeResolution = useSelector(state => getCurrentResolution(state));
  const mousePosition = useSelector(state => state.temporaryConfiguration.mousePosition);
  const activeViewport = useSelector(state => state.viewModeData.plane.activeViewport);
  const isPlaneMode = useSelector(state => getIsPlaneMode(state));

  const isSkeletonAnnotation = useSelector(state => state.tracing.skeleton != null);
  const isVolumeAnnotation = useSelector(state => state.tracing.volume != null);
  const activeCellId = useSelector(state =>
    state.tracing.volume ? state.tracing.volume.activeCellId : null,
  );
  const activeNodeId = useSelector(state =>
    state.tracing.skeleton ? state.tracing.skeleton.activeNodeId : null,
  );
  const activeTreeId = useSelector(state =>
    state.tracing.skeleton ? state.tracing.skeleton.activeTreeId : null,
  );

  const dispatch = useDispatch();
  const onChangeActiveCellId = id => dispatch(setActiveNodeAction(id));
  const onChangeActiveNodeId = id => dispatch(setActiveTreeAction(id));
  const onChangeActiveTreeId = id => dispatch(setActiveCellAction(id));

  const hasUint64Segmentation = useSelector(state => {
    const segmentationLayer = getSegmentationLayer(state.dataset);
    return segmentationLayer ? segmentationLayer.originalElementClass === "uint64" : false;
  });

  let globalMousePosition;
  if (mousePosition && activeViewport !== OrthoViews.TDView) {
    const [x, y] = mousePosition;
    globalMousePosition = calculateGlobalPos(Store.getState(), { x, y });
  }

  return (
    <Space size={spaceBetweenItems} style={spaceStyle}>
      <span>
        <img
          src="/assets/images/icon-statusbar-downsampling.svg"
          className="resolution-status-bar-icon"
          alt="Resolution"
        />{" "}
        {activeResolution.join("-")}{" "}
      </span>
      {isPlaneMode ? (
        <span className="info-element" style={{ minWidth: 140 }}>
          Pos [{globalMousePosition ? getPosString(globalMousePosition) : "-,-,-"}]
        </span>
      ) : null}
      {isPlaneMode ? getCellInfo(globalMousePosition) : null}

      {isSkeletonAnnotation ? (
        <span className="info-element" style={{ minWidth: 120 }}>
          <NumberInputPopoverSetting
            value={activeCellId}
            label={maybeLabelWithSegmentationWarning(hasUint64Segmentation, "Active Segment")}
            detailedLabel={maybeLabelWithSegmentationWarning(
              hasUint64Segmentation,
              "Change Active Segment ID",
            )}
            onChange={onChangeActiveCellId}
          />
        </span>
      ) : null}
      {isVolumeAnnotation ? (
        <span className="info-element" style={{ minWidth: 120 }}>
          <NumberInputPopoverSetting
            value={activeNodeId}
            label="Active Node"
            detailedLabel="Change Active Node ID"
            onChange={onChangeActiveNodeId}
          />
        </span>
      ) : null}
      {isSkeletonAnnotation ? (
        <span className="info-element" style={{ minWidth: 120 }}>
          <NumberInputPopoverSetting
            value={activeTreeId}
            label="Active Tree"
            detailedLabel="Change Active Tree ID"
            onChange={onChangeActiveTreeId}
          />
        </span>
      ) : null}
    </Space>
  );
}

class Statusbar extends React.PureComponent<{}, {}> {
  render() {
    return (
      <span className="statusbar">
        <Infos />
        <ShortcutsInfo />
      </span>
    );
  }
}

export default Statusbar;
