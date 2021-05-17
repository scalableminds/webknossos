// @flow
import { Space, Tooltip } from "antd";
import { useSelector } from "react-redux";
import React from "react";
import { useKeyPress } from "libs/react_hooks";
import Store from "oxalis/store";
import { type Vector3, OrthoViews } from "oxalis/constants";
import { getCurrentResolution } from "oxalis/model/accessors/flycam_accessor";
import { getToolClassForAnnotationTool } from "oxalis/controller/combinations/tool_controls";
import {
  calculateGlobalPos,
  isPlaneMode as getIsPlaneMode,
} from "oxalis/model/accessors/view_mode_accessor";
import { adaptActiveToolToShortcuts } from "oxalis/model/accessors/tool_accessor";
import api from "oxalis/api/internal_api";
import Cube from "oxalis/model/bucket_data_handling/data_cube";
import { V3 } from "libs/mjs";
import Model from "oxalis/model";
import { MoreOutlined } from "@ant-design/icons";

const borderToggleButtonMargin = 40;
const fontSize = 14;
const spaceBetweenItems = 25;
const lineColor = "rgba(255, 255, 255, 0.67)";

const statusbarStyle: Object = {
  marginLeft: borderToggleButtonMargin,
  marginRight: borderToggleButtonMargin,
  fontSize,
  display: "flex",
  flexWrap: "wrap",
  overflow: "hidden",
};
const defaultIconStyle = { height: fontSize, marginTop: 2 };
const defaultInfoStyle = { display: "inline-block", textAlign: "left" };
const defaultShortcutStyle = { marginLeft: spaceBetweenItems };
const spaceStyle = { display: "flex", flexWrap: "wrap" };
const moreIconStyle = { height: 14, color: lineColor };
const moreLinkStyle = { marginLeft: 10 };

const hasSegmentation = () => Model.getSegmentationLayer() != null;

function getSegmentationCube(): Cube {
  const segmentationLayer = Model.getSegmentationLayer();
  return segmentationLayer.cube;
}

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
        style={defaultIconStyle}
      />
      Zoom in/out
    </span>
  );
}

function LeftClickShortcut({ actionInfos }) {
  const leftClick =
    actionInfos.leftClick != null ? (
      <span
        style={{
          marginLeft: "auto",
        }}
      >
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-left.svg"
          alt="Mouse Left Click"
          style={defaultIconStyle}
        />
        {actionInfos.leftClick}
      </span>
    ) : null;

  const leftDrag =
    actionInfos.leftDrag != null ? (
      <span
        style={{
          marginLeft: "auto",
        }}
      >
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-left-drag.svg"
          alt="Mouse Left Drag"
          style={defaultIconStyle}
        />
        {actionInfos.leftDrag}
      </span>
    ) : null;

  return (
    <React.Fragment>
      {leftClick}
      {leftDrag}
    </React.Fragment>
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
          style={defaultIconStyle}
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
          style={defaultIconStyle}
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
            style={defaultIconStyle}
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
          style={defaultIconStyle}
        />
        Move along 3rd axis
      </span>
      <span style={defaultShortcutStyle}>
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-right-drag.svg"
          alt="Mouse Right"
          style={defaultIconStyle}
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
  const segmentationLayerName = Model.getSegmentationLayer().name;
  const cube = getSegmentationCube();
  const renderedZoomStepForMousePosition = api.data.getRenderedZoomStepAtPosition(
    segmentationLayerName,
    globalMousePosition,
  );
  const getIdForPos = (pos, usableZoomStep) => {
    const id = cube.getDataValue(pos, null, usableZoomStep);
    return cube.mapId(id);
  };
  const getSegmentIdString = () => {
    if (!globalMousePosition) return "-";
    const id = getIdForPos(globalMousePosition, renderedZoomStepForMousePosition);
    return cube.isMappingEnabled() ? `${id} (mapped)` : id;
  };

  return <span style={{ minWidth: 180, ...defaultInfoStyle }}>Segment {getSegmentIdString()}</span>;
}

function Infos() {
  const activeResolution = useSelector(state => getCurrentResolution(state));
  const mousePosition = useSelector(state => state.temporaryConfiguration.mousePosition);
  const activeViewport = useSelector(state => state.viewModeData.plane.activeViewport);
  const isPlaneMode = useSelector(state => getIsPlaneMode(state));

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
        <span style={{ minWidth: 140, ...defaultInfoStyle }}>
          Pos [{globalMousePosition ? getPosString(globalMousePosition) : "-,-,-"}]
        </span>
      ) : null}
      {isPlaneMode ? getCellInfo(globalMousePosition) : null}
    </Space>
  );
}

class Statusbar extends React.PureComponent<{}, {}> {
  render() {
    return (
      <span style={statusbarStyle}>
        <Infos />
        <ShortcutsInfo />
      </span>
    );
  }
}
export default Statusbar;
