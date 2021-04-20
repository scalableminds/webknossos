// @flow
import { Space, Tooltip } from "antd";
import _ from "lodash";
import { connect } from "react-redux";
import React from "react";

import Store, { type OxalisState } from "oxalis/store";
import {
  type Vector2,
  type Vector3,
  type OrthoView,
  OrthoViews,
  type AnnotationTool,
  AnnotationToolEnum,
} from "oxalis/constants";
import { getCurrentResolution } from "oxalis/model/accessors/flycam_accessor";
import { calculateGlobalPos, isPlaneMode } from "oxalis/model/accessors/view_mode_accessor";
import api from "oxalis/api/internal_api";
import Cube from "oxalis/model/bucket_data_handling/data_cube";
import { V3 } from "libs/mjs";
import Model from "oxalis/model";
import { MoreOutlined } from "@ant-design/icons";

type OwnProps = {||};
type StateProps = {|
  activeResolution: Vector3,
  activeViewport: OrthoView,
  mousePosition: ?Vector2,
  activeTool: AnnotationTool,
  isPlaneMode: boolean,
|};
type Props = {| ...OwnProps, ...StateProps |};
type State = {||};

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

const hasSegmentation = () => Model.getSegmentationLayer() != null;

class Statusbar extends React.PureComponent<Props, State> {
  getSegmentationCube(): Cube {
    const segmentationLayer = Model.getSegmentationLayer();
    return segmentationLayer.cube;
  }

  getPosString(pos: Vector3) {
    return V3.floor(pos).join(",");
  }

  getZoomShortcut() {
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

  getRightClickShortcut() {
    const rightClickToLabel = {
      MOVE: "Context Menu",
      SKELETON: "Place Node",
      BRUSH: "Erase",
      TRACE: "Erase",
      FILL_CELL: null,
      PICK_CELL: null,
    };
    const label = rightClickToLabel[this.props.activeTool];
    return (
      label && (
        <span style={defaultShortcutStyle}>
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-right.svg"
            alt="Mouse Left"
            style={defaultIconStyle}
          />
          {label}
        </span>
      )
    );
  }

  getShortcuts() {
    const moreShortcutsLink = (
      <a
        target="_blank"
        href="https://docs.webknossos.org/reference/keyboard_shortcuts"
        rel="noopener noreferrer"
        style={{ marginLeft: 10 }}
      >
        <Tooltip title="More Shortcuts">
          <MoreOutlined rotate={90} style={{ height: 14, color: lineColor }} />
        </Tooltip>
      </a>
    );
    if (!this.props.isPlaneMode) {
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
        <span
          style={{
            marginLeft: "auto",
            textTransform: "capitalize",
          }}
        >
          <img
            className="keyboard-mouse-icon"
            src={
              this.props.activeTool === AnnotationToolEnum.PICK_CELL ||
              this.props.activeTool === AnnotationToolEnum.FILL_CELL
                ? "/assets/images/icon-statusbar-mouse-left.svg"
                : "/assets/images/icon-statusbar-mouse-left-drag.svg"
            }
            alt="Mouse Left Drag"
            style={defaultIconStyle}
          />
          {this.props.activeTool.replace("_", " ").toLowerCase()}
        </span>
        {this.getRightClickShortcut()}
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
        {this.getZoomShortcut()}
        {moreShortcutsLink}
      </React.Fragment>
    );
  }

  getCellInfo(globalMousePosition: ?Vector3) {
    if (!hasSegmentation()) return null;
    const segmentationLayerName = Model.getSegmentationLayer().name;
    const cube = this.getSegmentationCube();
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

    return (
      <span style={{ minWidth: 180, ...defaultInfoStyle }}>Segment {getSegmentIdString()}</span>
    );
  }

  getInfos() {
    const { activeViewport, mousePosition, activeResolution } = this.props;
    let globalMousePosition;
    if (mousePosition && activeViewport !== OrthoViews.TDView) {
      const [x, y] = mousePosition;
      globalMousePosition = calculateGlobalPos(Store.getState(), { x, y });
    }

    return (
      <Space size={spaceBetweenItems} style={{ display: "flex", flexWrap: "wrap" }}>
        <span>
          <img
            src="/assets/images/icon-statusbar-downsampling.svg"
            style={{ height: 14, marginTop: -2 }}
            alt="Resolution"
          />{" "}
          {activeResolution.join("-")}{" "}
        </span>
        {this.props.isPlaneMode ? (
          <span style={{ minWidth: 140, ...defaultInfoStyle }}>
            Pos [{globalMousePosition ? this.getPosString(globalMousePosition) : "-,-,-"}]
          </span>
        ) : null}
        {this.props.isPlaneMode ? this.getCellInfo(globalMousePosition) : null}
      </Space>
    );
  }

  render() {
    return (
      <span style={statusbarStyle}>
        {this.getInfos()}
        {this.getShortcuts()}
      </span>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeResolution: getCurrentResolution(state),
  mousePosition: state.temporaryConfiguration.mousePosition,
  activeViewport: state.viewModeData.plane.activeViewport,
  activeTool: state.tracing.activeTool,
  isPlaneMode: isPlaneMode(state),
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(Statusbar);
