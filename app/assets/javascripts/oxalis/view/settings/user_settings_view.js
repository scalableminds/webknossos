/**
 * tracing_settings_view.js
 * @flow
 */

import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import { Collapse } from "antd";
import Constants from "oxalis/constants";
import Model from "oxalis/model";
import type { UserConfigurationType, OxalisState } from "oxalis/store";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { NumberInputSetting, SwitchSetting, NumberSliderSetting, BoundingBoxSetting, LogSliderSetting } from "./setting_input_views";

const Panel = Collapse.Panel;

class UserSettingsView extends Component {

  props: UserConfigurationType & { onChange: Function, oldModel: Model };

  state = {
    activeNodeId: 0,
    activeTreeId: 0,
    activeCellId: 0,
    zoom: 1,
  };

  componentDidMount() {
    this.updateIds();

    const wkModel = this.props.oldModel;
    wkModel.annotationModel.on("newTree", this.updateIds);
    wkModel.annotationModel.on("newActiveTree", this.updateIds);
    wkModel.annotationModel.on("newActiveNode", this.updateIds);
    wkModel.annotationModel.on("newActiveCell", this.updateIds);
    wkModel.on("change:mode", () => this.forceUpdate());
  }

  updateIds = () => {
    const wkModel = this.props.oldModel;
    if (wkModel.get("mode") in Constants.MODES_SKELETON) {
      this.setState({
        activeNodeId: wkModel.get("skeletonTracing").getActiveNodeId() || 0,
        activeTreeId: wkModel.get("skeletonTracing").getActiveTreeId() || 0,
        activeCellId: 0,
      });
    } else {
      this.setState({
        activeNodeId: 0,
        activeTreeId: 0,
        activeCellId: wkModel.get("volumeTracing").getActiveCellId() || 0,
      });
    }
  }

  onChangeActiveNodeId = (value: number) => {
    this.props.oldModel.get("skeletonTracing").setActiveNode(value);
    this.setState(Object.assign({}, this.state, { activeNodeId: value }));
  }

  onChangeActiveTreeId = (value: number) => {
    this.props.oldModel.get("skeletonTracing").setActiveTree(value);
    this.setState(Object.assign({}, this.state, { activeTreeId: value }));
  }

  onChangeActiveCellId = (value: number) => {
    this.props.oldModel.get("volumeTracing").setActiveCell(value);
    this.setState(Object.assign({}, this.state, { activeCellId: value }));
  }

  getViewportOptions = () => {
    const mode = this.props.oldModel.get("mode");
    if (mode === Constants.MODE_PLANE_TRACING || mode === Constants.MODE_VOLUME) {
      return (
        <Panel header="Viewport Options" key="1">
          <NumberSliderSetting label="Move Value (nm/s)" min={30} max={14000} step={10} value={this.props.moveValue} onChange={_.partial(this.props.onChange, "moveValue")} />
          <LogSliderSetting label="Zoom" min={0.1} max={this.props.oldModel.get("flycam").getMaxZoomStep()} value={this.props.zoom} onChange={_.partial(this.props.onChange, "zoom")} />
          <NumberSliderSetting label="Viewport Scale" min={0.05} max={20} step={0.1} value={this.props.scale} onChange={_.partial(this.props.onChange, "scale")} />
          <NumberSliderSetting label="Clipping Distance" max={12000} value={this.props.clippingDistance} onChange={_.partial(this.props.onChange, "clippingDistance")} />
          <SwitchSetting label="d/f-Switching" value={this.props.dynamicSpaceDirection} onChange={_.partial(this.props.onChange, "dynamicSpaceDirection")} />
          <SwitchSetting label="Show Crosshairs" value={this.props.displayCrosshair} onChange={_.partial(this.props.onChange, "displayCrosshair")} />
        </Panel>
      );
    } else {
      return (
        <Panel header="Flight Options" key="1">
          <NumberInputSetting label="Mouse Rotation" min={0.0001} max={0.02} step={0.001} value={this.props.mouseRotateValue} onChange={_.partial(this.props.onChange, "mouseRotateValue")} />
          <NumberInputSetting label="Keyboard Rotation Value" min={0.001} max={0.08} step={0.001} value={this.state.activeNodeId} onChange={this.onChangeActiveNodeId} />
          <NumberInputSetting label="Move Value (nm/s)" min={30} max={1500} step={10} value={this.props.moveValue3d} onChange={_.partial(this.props.onChange, "moveValue3d")} />
          <NumberInputSetting label="Crosshair Size" min={0.05} max={0.5} step={0.01} value={this.props.crosshairSize} onChange={_.partial(this.props.onChange, "crosshairSize")} />
          <NumberInputSetting label="Sphere Radius" min={50} max={500} step={1} value={this.props.sphericalCapRadius} onChange={_.partial(this.props.onChange, "sphericalCapRadius")} />
          <NumberInputSetting label="Clipping Distance" max={127} value={this.props.clippingDistanceArbitrary} onChange={_.partial(this.props.onChange, "clippingDistanceArbitrary")} />
          <SwitchSetting label="Show Crosshair" value={this.props.displayCrosshair} onChange={_.partial(this.props.onChange, "displayCrosshair")} />
        </Panel>
      );
    }
  }

  getSkeletonOrVolumeOptions = () => {
    const mode = this.props.oldModel.get("mode");
    if (mode in Constants.MODES_SKELETON) {
      return (
        <Panel header="Nodes & Trees" key="2">
          <NumberInputSetting label="Active Node ID" value={this.state.activeNodeId} onChange={this.onChangeActiveNodeId} />
          <NumberInputSetting label="Active Tree ID" value={this.state.activeTreeId} onChange={this.onChangeActiveTreeId} />
          <NumberSliderSetting label="Radius" max={5000} value={this.props.radius} onChange={_.partial(this.props.onChange, "radius")} />
          <NumberSliderSetting label="Particle Size" max={20} step={0.1} value={this.props.particleSize} onChange={_.partial(this.props.onChange, "particleSize")} />
          <SwitchSetting label="Soma Clicking" value={this.props.newNodeNewTree} onChange={_.partial(this.props.onChange, "newNodeNewTree")} />
          <SwitchSetting label="Override Radius" value={this.props.overrideNodeRadius} onChange={_.partial(this.props.onChange, "overrideNodeRadius")} />
        </Panel>
      );
    } else if (mode === Constants.MODE_VOLUME) {
      return (
        <Panel header="Volume Options" key="2">
          <NumberInputSetting label="Active Cell ID" value={this.state.activeCellId} onChange={this.onChangeActiveCellId} />
          <NumberInputSetting label="Segment Opacity" max={100} value={this.props.segmentationOpacity} onChange={_.partial(this.props.onChange, "segmentationOpacity")} />
          <SwitchSetting label="3D Volume Rendering" value={this.props.isosurfaceDisplay} onChange={_.partial(this.props.onChange, "isosurfaceDisplay")} />
          <NumberInputSetting label="3D Rendering Bounding Box Size" min={1} max={10} step={0.1} value={this.props.isosurfaceBBsize} onChange={_.partial(this.props.onChange, "isosurfaceBBsize")} />
          <NumberInputSetting label="3D Rendering Resolution" min={40} max={400} value={this.props.isosurfaceResolution} onChange={_.partial(this.props.onChange, "isosurfaceResolution")} />
        </Panel>
      );
    }
    return null;
  };

  render() {
    return (
      <Collapse defaultActiveKey={["1", "2", "3", "4"]}>
        { this.getViewportOptions() }
        { this.getSkeletonOrVolumeOptions() }
        <Panel header="Controls" key="3">
          <SwitchSetting label="Inverse X" value={this.props.inverseX} onChange={_.partial(this.props.onChange, "inverseX")} />
          <SwitchSetting label="Inverse Y" value={this.props.inverseY} onChange={_.partial(this.props.onChange, "inverseY")} />
          <NumberSliderSetting label="Keyboard delay (ms)" min={0} max={500} value={this.props.keyboardDelay} onChange={_.partial(this.props.onChange, "keyboardDelay")} />
        </Panel>
        <Panel header="Other" key="4">
          <BoundingBoxSetting label="Bounding Box" value={this.props.boundingBox} onChange={_.partial(this.props.onChange, "boundingBox")} />
          <SwitchSetting label="Display Planes in 3D View" value={this.props.tdViewDisplayPlanes} onChange={_.partial(this.props.onChange, "tdViewDisplayPlanes")} />
          <SwitchSetting label="Render Comments in Abstract Tree" value={this.props.renderComments} onChange={_.partial(this.props.onChange, "renderComments")} />
        </Panel>
      </Collapse>
    );
  }
}

const mapStateToProps = (state: OxalisState) => (
  state.userConfiguration
);

const mapDispatchToProps = dispatch => ({
  onChange(propertyName, value) { dispatch(updateUserSettingAction(propertyName, value)); },
});

export default connect(mapStateToProps, mapDispatchToProps)(UserSettingsView);
