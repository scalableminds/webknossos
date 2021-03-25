// @flow
import { Layout, Col, Tooltip } from "antd";
import _ from "lodash";
import { connect } from "react-redux";
import React from "react";

import type { OxalisState } from "oxalis/store";
import { type Vector2, type Vector3, type OrthoView, OrthoViews } from "oxalis/constants";
import { getCurrentResolution } from "oxalis/model/accessors/flycam_accessor";
import api from "oxalis/api/internal_api";
import DataLayer from "oxalis/model/data_layer";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import Cube from "oxalis/model/bucket_data_handling/data_cube";
import { V3 } from "libs/mjs";
import Model from "oxalis/model";
const { Footer } = Layout;

type OwnProps = {||};
type StateProps = {|
  isInAnnotationView: boolean,
  activeResolution: Vector3,
  activeViewport: OrthoView,
  mousePosition: ?Vector2,
  // activeCellId: ?number,
  // segmentationLayer: APILayer,
|};
type Props = {| ...OwnProps, ...StateProps |};
type State = {||};

export const statusbarHeight = 18;

const statusbarStyle: Object = {
  padding: 0,
  overflowX: "auto",
  position: "fixed",
  bottom: 0,
  width: "100%",
  zIndex: 1000,
  fontSize: 10,
  height: statusbarHeight,
  display: "flex",
  alignItems: "center",
  color: "rgba(255, 255, 255, 0.67)",
  background: "#001529",
  whiteSpace: "nowrap",
  paddingLeft: 5,
};
const hasSegmentation = () => Model.getSegmentationLayer() != null;

class Statusbar extends React.PureComponent<Props, State> {
  isMounted: boolean = false;
  componentDidMount() {
    this.isMounted = true;
    if (!hasSegmentation()) {
      return;
    }
    const cube = this.getSegmentationCube();
    cube.off("bucketLoaded", this._forceUpdate);
    cube.off("volumeLabeled", this._forceUpdate);
  }

  componentWillUnmount() {
    this.isMounted = false;
    if (!hasSegmentation()) {
      return;
    }
    const cube = this.getSegmentationCube();
    cube.off("bucketLoaded", this._forceUpdate);
    cube.off("volumeLabeled", this._forceUpdate);
  }

  // eslint-disable-next-line react/sort-comp
  _forceUpdate = _.throttle(() => {
    if (!this.isMounted) {
      return;
    }
    this.forceUpdate();
  }, 100);

  getSegmentationLayer(): DataLayer {
    const layer = Model.getSegmentationLayer();
    if (!layer) {
      throw new Error("No segmentation layer found");
    }
    return layer;
  }

  getSegmentationCube(): Cube {
    const segmentationLayer = this.getSegmentationLayer();
    return segmentationLayer.cube;
  }

  render() {
    if (!hasSegmentation()) {
      return "No segmentation available";
    }
    const { activeViewport, mousePosition, activeResolution } = this.props;
    let globalMousePosition;
    if (mousePosition && activeViewport !== OrthoViews.TDView) {
      const [x, y] = mousePosition;
      globalMousePosition = calculateGlobalPos({ x, y });
    }

    const segmentationLayerName = this.getSegmentationLayer().name;
    const cube = this.getSegmentationCube();

    const renderedZoomStepForMousePosition = api.data.getRenderedZoomStepAtPosition(
      segmentationLayerName,
      globalMousePosition,
    );

    const getIdForPos = (pos, usableZoomStep) =>
      pos && cube.getDataValue(pos, null, usableZoomStep);

    const collapseAllNavItems = this.props.isInAnnotationView;
    const getPosString = pos => V3.floor(pos).join(",");
    return (
      <Footer style={statusbarStyle} className={collapseAllNavItems ? "collapsed-nav-footer" : ""}>
        <Col span={6}>
          <Tooltip
            title={
              <div>
                Currently rendered resolution {activeResolution.join("-")}.<br />
              </div>
            }
            placement="top"
          >
            <span>
              <img
                src="/assets/images/icon-downsampling.svg"
                style={{ width: 15, height: 15 }}
                alt="Resolution"
              />
              {activeResolution.join("-")}{" "}
            </span>
          </Tooltip>
          <span style={{ paddingLeft: 30 }}>
            Cell:{" "}
            {globalMousePosition
              ? getIdForPos(globalMousePosition, renderedZoomStepForMousePosition)
              : "-"}
          </span>
          <span style={{ paddingLeft: 30 }}>
            Pos: [{globalMousePosition ? getPosString(globalMousePosition) : "-,-,-"}]
          </span>
        </Col>
        <Col span={12}>
          <span>
            <img
              key="move-1"
              className="keyboard-mouse-icon"
              src="/assets/images/icon-mouse-left-drag.svg"
              alt="Mouse Left Drag"
              style={{ height: 12 }}
            />
            Move
          </span>
          <span style={{ paddingLeft: 30 }}>
            <img
              key="move-1"
              className="keyboard-mouse-icon"
              src="/assets/images/icon-mousewheel.svg"
              alt="Mouse Wheel"
              style={{ height: 12 }}
            />
            Move along 3rd axis
          </span>
          {activeViewport === OrthoViews.TDView && (
            <span style={{ paddingLeft: 30 }}>
              <img
                key="move-1"
                className="keyboard-mouse-icon"
                src="/assets/images/icon-mouse-right.svg"
                alt="Mouse Right"
                style={{ height: 12 }}
              />
              Rotate 3D View
            </span>
          )}
          <span key="zoom" className="bordered" style={{ paddingLeft: 30 }}>
            I/O
          </span>{" "}
          Zoom in/out
        </Col>
      </Footer>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  isInAnnotationView: state.uiInformation.isInAnnotationView,
  activeResolution: getCurrentResolution(state),
  mousePosition: state.temporaryConfiguration.mousePosition,
  activeViewport: state.viewModeData.plane.activeViewport,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(Statusbar);
