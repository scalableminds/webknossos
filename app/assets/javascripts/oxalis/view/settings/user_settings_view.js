/**
 * tracing_settings_view.js
 * @flow
 */

import _ from "lodash";
import React, { Component } from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import { Collapse } from "antd";
import Constants from "oxalis/constants";
import Model from "oxalis/model";
import { updateUserSettingAction, updateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import { NumberInputSetting, SwitchSetting, NumberSliderSetting, Vector6InputSetting, LogSliderSetting } from "oxalis/view/settings/setting_input_views";
import type { Vector6 } from "oxalis/constants";
import type { UserConfigurationType, TemporaryConfigurationType, OxalisState } from "oxalis/store";

const Panel = Collapse.Panel;

class UserSettingsView extends Component {

  props: {
    userConfiguration: UserConfigurationType,
    temporaryConfiguration: TemporaryConfigurationType,
    onChangeUser: (key: $Keys<UserConfigurationType>, value: any) => void,
    onChangeTemporary: (key: $Keys<TemporaryConfigurationType>, value: any) => void,
    oldModel: Model,
  };

  state = {
    activeNodeId: 0,
    activeTreeId: 0,
    activeCellId: 0,
    zoom: 1,
    radius: 10,
  };

  componentDidMount() {
    this.updateIds();

    const wkModel = this.props.oldModel;
    wkModel.annotationModel.on("newTree", this.updateIds);
    wkModel.annotationModel.on("newActiveTree", this.updateIds);
    wkModel.annotationModel.on("newActiveNode", this.updateIds);
    wkModel.annotationModel.on("newActiveCell", this.updateIds);
    wkModel.annotationModel.on("newActiveNodeRadius", this.updateIds);
    wkModel.on("change:mode", () => this.forceUpdate());
  }

  updateIds = () => {
    const wkModel = this.props.oldModel;
    if (wkModel.get("mode") in Constants.MODES_SKELETON) {
      this.setState({
        activeNodeId: wkModel.get("skeletonTracing").getActiveNodeId() || 0,
        activeTreeId: wkModel.get("skeletonTracing").getActiveTreeId() || 0,
        activeCellId: 0,
        radius: this.state.radius,
      });
    } else {
      this.setState({
        activeNodeId: 0,
        activeTreeId: 0,
        activeCellId: wkModel.get("volumeTracing").getActiveCellId() || 0,
        radius: this.state.radius,
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

  onChangeRadius = (radius: number) => {
    this.setState(Object.assign({}, this.state, { radius }), () => {
      this.props.oldModel.get("skeletonTracing").setActiveNodeRadius(radius);
      this.props.onChangeUser("radius", radius);
    });
  }

  onChangeBoundingBox = (boundingBox: Vector6) => {
    this.props.oldModel.setUserBoundingBox(boundingBox);
    this.props.onChangeTemporary("boundingBox", boundingBox);
  }

  getViewportOptions = () => {
    const mode = this.props.oldModel.get("mode");
    switch (mode) {
      case Constants.MODE_PLANE_TRACING:
        return (
          <Panel header="Viewport Options" key="2">
            <LogSliderSetting label="Zoom" min={0.1} max={this.props.oldModel.get("flycam").getMaxZoomStep()} value={this.props.userConfiguration.zoom} onChange={_.partial(this.props.onChangeUser, "zoom")} />
            <NumberSliderSetting label="Viewport Scale" min={0.05} max={20} step={0.1} value={this.props.userConfiguration.scale} onChange={_.partial(this.props.onChangeUser, "scale")} />
            <NumberSliderSetting label="Clipping Distance" max={12000} value={this.props.userConfiguration.clippingDistance} onChange={_.partial(this.props.onChangeUser, "clippingDistance")} />
            <SwitchSetting label="Show Crosshairs" value={this.props.userConfiguration.displayCrosshair} onChange={_.partial(this.props.onChangeUser, "displayCrosshair")} />
          </Panel>
        );
      case Constants.MODE_VOLUME:
        return (
          <Panel header="Viewport Options" key="2">
            <LogSliderSetting label="Zoom" min={0.1} max={this.props.oldModel.get("flycam").getMaxZoomStep()} value={this.props.userConfiguration.zoom} onChange={_.partial(this.props.onChangeUser, "zoom")} />
            <NumberSliderSetting label="Viewport Scale" min={0.05} max={20} step={0.1} value={this.props.userConfiguration.scale} onChange={_.partial(this.props.onChangeUser, "scale")} />
            <SwitchSetting label="Show Crosshairs" value={this.props.userConfiguration.displayCrosshair} onChange={_.partial(this.props.onChangeUser, "displayCrosshair")} />
          </Panel>
        );
      default:
        return (
          <Panel header="Flight Options" key="2">
            <NumberSliderSetting label="Mouse Rotation" min={0.0001} max={0.02} step={0.001} value={this.props.userConfiguration.mouseRotateValue} onChange={_.partial(this.props.onChangeUser, "mouseRotateValue")} />
            <NumberSliderSetting label="Keyboard Rotation Value" min={0.001} max={0.08} step={0.001} value={this.state.activeNodeId} onChange={this.onChangeActiveNodeId} />
            <NumberSliderSetting label="Move Value (nm/s)" min={30} max={1500} step={10} value={this.props.userConfiguration.moveValue3d} onChange={_.partial(this.props.onChangeUser, "moveValue3d")} />
            <NumberSliderSetting label="Crosshair Size" min={0.05} max={0.5} step={0.01} value={this.props.userConfiguration.crosshairSize} onChange={_.partial(this.props.onChangeUser, "crosshairSize")} />
            <NumberSliderSetting label="Sphere Radius" min={50} max={500} step={1} value={this.props.userConfiguration.sphericalCapRadius} onChange={_.partial(this.props.onChangeUser, "sphericalCapRadius")} />
            <NumberSliderSetting label="Clipping Distance" max={127} value={this.props.userConfiguration.clippingDistanceArbitrary} onChange={_.partial(this.props.onChangeUser, "clippingDistanceArbitrary")} />
            <SwitchSetting label="Show Crosshair" value={this.props.userConfiguration.displayCrosshair} onChange={_.partial(this.props.onChangeUser, "displayCrosshair")} />
          </Panel>
        );
    }
  }

  getSkeletonOrVolumeOptions = () => {
    const mode = this.props.oldModel.get("mode");
    if (mode in Constants.MODES_SKELETON) {
      return (
        <Panel header="Nodes & Trees" key="3">
          <NumberInputSetting label="Active Node ID" value={this.state.activeNodeId} onChange={this.onChangeActiveNodeId} />
          <NumberInputSetting label="Active Tree ID" value={this.state.activeTreeId} onChange={this.onChangeActiveTreeId} />
          <NumberSliderSetting label="Radius" max={5000} value={this.state.radius} onChange={this.onChangeRadius} />
          <NumberSliderSetting label="Particle Size" max={20} step={0.1} value={this.props.userConfiguration.particleSize} onChange={_.partial(this.props.onChangeUser, "particleSize")} />
          <SwitchSetting label="Soma Clicking" value={this.props.userConfiguration.newNodeNewTree} onChange={_.partial(this.props.onChangeUser, "newNodeNewTree")} />
          <SwitchSetting label="Override Radius" value={this.props.userConfiguration.overrideNodeRadius} onChange={_.partial(this.props.onChangeUser, "overrideNodeRadius")} />
        </Panel>
      );
    } else if (mode === Constants.MODE_VOLUME) {
      return (
        <Panel header="Volume Options" key="3">
          <NumberInputSetting label="Active Cell ID" value={this.state.activeCellId} onChange={this.onChangeActiveCellId} />
          <SwitchSetting label="3D Volume Rendering" value={this.props.userConfiguration.isosurfaceDisplay} onChange={_.partial(this.props.onChangeUser, "isosurfaceDisplay")} />
          <NumberSliderSetting label="3D Rendering Bounding Box Size" min={1} max={10} step={0.1} value={this.props.userConfiguration.isosurfaceBBsize} onChange={_.partial(this.props.onChangeUser, "isosurfaceBBsize")} />
          <NumberSliderSetting label="3D Rendering Resolution" min={40} max={400} value={this.props.userConfiguration.isosurfaceResolution} onChange={_.partial(this.props.onChangeUser, "isosurfaceResolution")} />
        </Panel>
      );
    }
    return null;
  };

  render() {
    return (
      <Collapse defaultActiveKey={["1", "2", "3", "4"]}>
        <Panel header="Controls" key="1">
          <NumberSliderSetting label="Keyboard delay (ms)" min={0} max={500} value={this.props.userConfiguration.keyboardDelay} onChange={_.partial(this.props.onChangeUser, "keyboardDelay")} />
          <NumberSliderSetting label="Move Value (nm/s)" min={30} max={14000} step={10} value={this.props.userConfiguration.moveValue} onChange={_.partial(this.props.onChangeUser, "moveValue")} />
          <SwitchSetting label="Inverse X" value={this.props.userConfiguration.inverseX} onChange={_.partial(this.props.onChangeUser, "inverseX")} />
          <SwitchSetting label="Inverse Y" value={this.props.userConfiguration.inverseY} onChange={_.partial(this.props.onChangeUser, "inverseY")} />
          <SwitchSetting label="d/f-Switching" value={this.props.userConfiguration.dynamicSpaceDirection} onChange={_.partial(this.props.onChangeUser, "dynamicSpaceDirection")} />
        </Panel>
        { this.getViewportOptions() }
        { this.getSkeletonOrVolumeOptions() }
        <Panel header="Segmentation" key="4">
          <NumberSliderSetting label="Segmentation Opacity" max={100} value={this.props.userConfiguration.segmentationOpacity} onChange={_.partial(this.props.onChangeUser, "segmentationOpacity")} />
        </Panel>
        <Panel header="Other" key="5">
          <Vector6InputSetting label="Bounding Box" tooltipTitle="Format: minX, minY, minZ, width, height, depth" value={this.props.temporaryConfiguration.boundingBox} onChange={this.onChangeBoundingBox} />
          <SwitchSetting label="Display Planes in 3D View" value={this.props.userConfiguration.tdViewDisplayPlanes} onChange={_.partial(this.props.onChangeUser, "tdViewDisplayPlanes")} />
        </Panel>
      </Collapse>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  userConfiguration: state.userConfiguration,
  temporaryConfiguration: state.temporaryConfiguration,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeUser(propertyName, value) { dispatch(updateUserSettingAction(propertyName, value)); },
  onChangeTemporary(propertyName, value) { dispatch(updateTemporarySettingAction(propertyName, value)); },
});

export default connect(mapStateToProps, mapDispatchToProps)(UserSettingsView);
