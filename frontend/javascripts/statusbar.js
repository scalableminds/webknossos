// @flow
import { Space, Tooltip } from "antd";
import _ from "lodash";
import { connect } from "react-redux";
import React from "react";

import type { OxalisState } from "oxalis/store";
import {
  type Vector2,
  type Vector3,
  type OrthoView,
  OrthoViews,
  type VolumeTool,
} from "oxalis/constants";
import { getCurrentResolution } from "oxalis/model/accessors/flycam_accessor";
import api from "oxalis/api/internal_api";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import Cube from "oxalis/model/bucket_data_handling/data_cube";
import { V3 } from "libs/mjs";
import Model from "oxalis/model";
import { MoreOutlined } from "@ant-design/icons";

type OwnProps = {||};
type StateProps = {|
  activeResolution: Vector3,
  activeViewport: OrthoView,
  mousePosition: ?Vector2,
  isSkeletonAnnotation: boolean,
  activeTool: ?VolumeTool,
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
const defaultIconStyle = { height: fontSize - 1, marginTop: 2 };
const defaultInfoStyle = { display: "inline-block", minWidth: 150, textAlign: "left" };
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

  getShortcuts() {
    return (
      <React.Fragment>
        {this.props.isSkeletonAnnotation && (
          <span style={{ marginLeft: "auto" }}>
            <img
              className="keyboard-mouse-icon"
              src="/assets/images/icon-statusbar-mouse-right.svg"
              alt="Mouse Left"
              style={defaultIconStyle}
            />
            Place Node
          </span>
        )}
        <span
          style={{
            marginLeft: this.props.isSkeletonAnnotation ? spaceBetweenItems : "auto",
            textTransform: "capitalize",
          }}
        >
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-statusbar-mouse-left-drag.svg"
            alt="Mouse Left Drag"
            style={defaultIconStyle}
          />
          {this.props.activeTool ? this.props.activeTool.replace("_", " ").toLowerCase() : "Move"}
        </span>
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
      </React.Fragment>
    );
  }

  getCellInfo(globalMousePosition: ?Vector3) {
    const segmentationLayerName = Model.getSegmentationLayer().name;
    const cube = this.getSegmentationCube();
    const renderedZoomStepForMousePosition = api.data.getRenderedZoomStepAtPosition(
      segmentationLayerName,
      globalMousePosition,
    );
    const getIdForPos = (pos, usableZoomStep) =>
      pos && cube.getDataValue(pos, null, usableZoomStep);

    return (
      <span style={defaultInfoStyle}>
        Segment{" "}
        {globalMousePosition
          ? getIdForPos(globalMousePosition, renderedZoomStepForMousePosition)
          : "-"}
      </span>
    );
  }

  getInfos() {
    const { activeViewport, mousePosition, activeResolution } = this.props;
    let globalMousePosition;
    if (mousePosition && activeViewport !== OrthoViews.TDView) {
      const [x, y] = mousePosition;
      globalMousePosition = calculateGlobalPos({ x, y });
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
        <span style={defaultInfoStyle}>
          Pos [{globalMousePosition ? this.getPosString(globalMousePosition) : "-,-,-"}]
        </span>
        {hasSegmentation() && this.getCellInfo(globalMousePosition)}
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
  isSkeletonAnnotation: state.tracing.skeleton != null,
  activeTool: state.tracing.volume ? state.tracing.volume.activeTool : null,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(Statusbar);
