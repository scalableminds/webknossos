// @flow
import { Col, Row } from "antd";
import _ from "lodash";
import { connect } from "react-redux";
import React from "react";

import type { OxalisState } from "oxalis/store";
import { type Vector2, type Vector3, type OrthoView, OrthoViews } from "oxalis/constants";
import { getCurrentResolution } from "oxalis/model/accessors/flycam_accessor";
import api from "oxalis/api/internal_api";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import Cube from "oxalis/model/bucket_data_handling/data_cube";
import { V3 } from "libs/mjs";
import Model from "oxalis/model";

type OwnProps = {||};
type StateProps = {|
  activeResolution: Vector3,
  activeViewport: OrthoView,
  mousePosition: ?Vector2,
|};
type Props = {| ...OwnProps, ...StateProps |};
type State = {||};

const borderToggleButtonMargin = 40;
const spaceBetweenItems = 20;

const statusbarStyle: Object = {
  paddingTop: 2,
  marginLeft: borderToggleButtonMargin,
  marginRight: borderToggleButtonMargin,
};

const hasSegmentation = () => Model.getSegmentationLayer() != null;

class Statusbar extends React.PureComponent<Props, State> {
  isMounted: boolean = false;
  componentDidMount() {
    this.isMounted = true;
  }

  componentWillUnmount() {
    this.isMounted = false;
  }

  // eslint-disable-next-line react/sort-comp
  _forceUpdate = _.throttle(() => {
    if (!this.isMounted) {
      return;
    }
    this.forceUpdate();
  }, 100);

  getSegmentationCube(): Cube {
    const segmentationLayer = Model.getSegmentationLayer();
    return segmentationLayer.cube;
  }

  getPosString(pos: Vector3) {
    return V3.floor(pos).join(",");
  }

  getZoomShortcut() {
    return (
      <span key="zoom">
        <span
          key="zoom-i"
          className="keyboard-key-icon-small"
          style={{
            marginLeft: spaceBetweenItems,
            borderColor: "rgba(255, 255, 255, 0.67)",
          }}
        >
          I
        </span>{" "}
        /{" "}
        <span
          key="zoom-o"
          className="keyboard-key-icon-small"
          style={{
            borderColor: "rgba(255, 255, 255, 0.67)",
          }}
        >
          O
        </span>{" "}
        Zoom in/out
      </span>
    );
  }

  getShortcuts() {
    const { activeViewport } = this.props;
    return (
      <Col span={14} style={{ textAlign: "right" }}>
        <span>
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-mouse-left-drag.svg"
            alt="Mouse Left Drag"
            style={{ height: 12 }}
          />
          Move
        </span>
        <span style={{ marginLeft: spaceBetweenItems }}>
          <img
            className="keyboard-mouse-icon"
            src="/assets/images/icon-mousewheel.svg"
            alt="Mouse Wheel"
            style={{ height: 12 }}
          />
          Move along 3rd axis
        </span>
        {this.getZoomShortcut()}
        {activeViewport === OrthoViews.TDView && (
          <span
            style={{
              marginLeft: spaceBetweenItems,
            }}
          >
            <img
              className="keyboard-mouse-icon"
              src="/assets/images/icon-mouse-right.svg"
              alt="Mouse Right"
              style={{ height: 12 }}
            />
            Rotate 3D View
          </span>
        )}
      </Col>
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
      <span style={{ marginLeft: spaceBetweenItems }}>
        Cell:{" "}
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
      <Col span={10} style={{ textAlign: "left" }}>
        <span>
          <img
            src="/assets/images/icon-downsampling.svg"
            style={{ width: 15, height: 15 }}
            alt="Resolution"
          />
          {activeResolution.join("-")}{" "}
        </span>
        <span style={{ marginLeft: spaceBetweenItems }}>
          Pos: [{globalMousePosition ? this.getPosString(globalMousePosition) : "-,-,-"}]
        </span>
        {hasSegmentation() && this.getCellInfo(globalMousePosition)}
      </Col>
    );
  }

  render() {
    return (
      <Row style={statusbarStyle}>
        {this.getInfos()}
        {this.getShortcuts()}
      </Row>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeResolution: getCurrentResolution(state),
  mousePosition: state.temporaryConfiguration.mousePosition,
  activeViewport: state.viewModeData.plane.activeViewport,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(Statusbar);
