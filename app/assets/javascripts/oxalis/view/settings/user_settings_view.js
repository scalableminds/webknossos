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
import { setActiveNodeAction, setActiveTreeAction, setActiveNodeRadiusAction } from "oxalis/model/actions/skeletontracing_actions";
import { NumberInputSetting, SwitchSetting, NumberSliderSetting, Vector6InputSetting, LogSliderSetting } from "oxalis/view/settings/setting_input_views";
import type { Vector6 } from "oxalis/constants";
import type { UserConfigurationType, TemporaryConfigurationType, OxalisState, SkeletonTracingType } from "oxalis/store";
import { getMaxZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { setZoomStepAction } from "oxalis/model/actions/flycam_actions";

const Panel = Collapse.Panel;

type UserSettingsViewProps = {
  userConfiguration: UserConfigurationType,
  temporaryConfiguration: TemporaryConfigurationType,
  skeletonTracing: SkeletonTracingType,
  zoomStep: number,
  state: OxalisState,
  onChangeUser: (key: $Keys<UserConfigurationType>, value: any) => void,
  onChangeTemporary: (key: $Keys<TemporaryConfigurationType>, value: any) => void,
  onChangeActiveNodeId: (value: number) => void,
  onChangeActiveTreeId: (value: number) => void,
  onChangeRadius: (value: number) => void,
  onChangeZoomStep: (value: number) => void,
  oldModel: Model,
  isPublicViewMode: boolean,
};

type UserSettingsViewState = {
  activeCellId: number,
};

class UserSettingsView extends Component {

  props: UserSettingsViewProps;
  onChangeUser: {[$Keys<UserConfigurationType>]: Function};
  onChangeTemporary: {[$Keys<TemporaryConfigurationType>]: Function};

  state: UserSettingsViewState = {
    activeCellId: 0,
  };

  componentWillMount() {
    // cache onChange handler
    this.onChangeUser = _.mapValues(this.props.userConfiguration, (__, propertyName) =>
      _.partial(this.props.onChangeUser, propertyName),
    );
  }

  componentDidMount() {
    // remove public mode prop once oldModel is no longer a prop of this
    if (!this.props.isPublicViewMode) {
      this.updateIds();

      const wkModel = this.props.oldModel;
      // wkModel.annotationModel.on("newActiveCell", this.updateIds);
      wkModel.on("change:mode", () => this.forceUpdate());
    }
  }

  shouldComponentUpdate(nextProps: UserSettingsViewProps, nextState: UserSettingsViewState) {
    return this.props.userConfiguration !== nextProps.userConfiguration
      || this.props.temporaryConfiguration !== nextProps.temporaryConfiguration
      || this.props.skeletonTracing !== nextProps.skeletonTracing
      || this.props.state !== nextProps.state
      || this.state.activeCellId !== nextState.activeCellId;
  }

  updateIds = () => {
    const wkModel = this.props.oldModel;
    if (wkModel.get("mode") in Constants.MODES_SKELETON) {
      this.setState({
        activeCellId: 0,
      });
    } else {
      this.setState({
        activeCellId: wkModel.get("volumeTracing").getActiveCellId() || 0,
      });
    }
  }

  onChangeActiveCellId = (value: number) => {
    this.props.oldModel.get("volumeTracing").setActiveCell(value);
    this.setState(Object.assign({}, this.state, { activeCellId: value }));
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
            <LogSliderSetting label="Zoom" min={0.05} max={getMaxZoomStep(this.props.state)} value={this.props.zoomStep} onChange={this.props.onChangeZoomStep} />
            <LogSliderSetting label="Viewport Scale" min={0.05} max={20} step={0.1} value={this.props.userConfiguration.scale} onChange={this.onChangeUser.scale} />
            <LogSliderSetting label="Clipping Distance" min={1} max={12000} value={this.props.userConfiguration.clippingDistance} onChange={this.onChangeUser.clippingDistance} />
            <SwitchSetting label="Show Crosshairs" value={this.props.userConfiguration.displayCrosshair} onChange={this.onChangeUser.displayCrosshair} />
          </Panel>
        );
      case Constants.MODE_VOLUME:
        return (
          <Panel header="Viewport Options" key="2">
            <LogSliderSetting label="Zoom" min={0.1} max={getMaxZoomStep(this.props.state)} value={this.props.zoomStep} onChange={this.props.onChangeZoomStep} />
            <LogSliderSetting label="Viewport Scale" min={0.05} max={20} step={0.1} value={this.props.userConfiguration.scale} onChange={this.onChangeUser.scale} />
            <SwitchSetting label="Show Crosshairs" value={this.props.userConfiguration.displayCrosshair} onChange={this.onChangeUser.displayCrosshair} />
          </Panel>
        );
      default:
        return (
          <Panel header="Flight Options" key="2">
            <NumberSliderSetting label="Mouse Rotation" min={0.0001} max={0.02} step={0.001} value={this.props.userConfiguration.mouseRotateValue} onChange={this.onChangeUser.mouseRotateValue} />
            <NumberSliderSetting label="Keyboard Rotation" min={0.001} max={0.08} step={0.001} value={this.props.userConfiguration.rotateValue} onChange={this.onChangeUser.rotateValue} />
            <NumberSliderSetting label="Crosshair Size" min={0.05} max={0.5} step={0.01} value={this.props.userConfiguration.crosshairSize} onChange={this.onChangeUser.crosshairSize} />
            <NumberSliderSetting label="Sphere Radius" min={50} max={500} step={1} value={this.props.userConfiguration.sphericalCapRadius} onChange={this.onChangeUser.sphericalCapRadius} />
            <NumberSliderSetting label="Clipping Distance" max={127} value={this.props.userConfiguration.clippingDistanceArbitrary} onChange={this.onChangeUser.clippingDistanceArbitrary} />
            <SwitchSetting label="Show Crosshair" value={this.props.userConfiguration.displayCrosshair} onChange={this.onChangeUser.displayCrosshair} />
          </Panel>
        );
    }
  }

  getSkeletonOrVolumeOptions = () => {
    const mode = this.props.oldModel.get("mode");
    const activeNodeId = this.props.skeletonTracing.activeNodeId != null ? this.props.skeletonTracing.activeNodeId : "";
    const activeTreeId = this.props.skeletonTracing.activeTreeId != null ? this.props.skeletonTracing.activeTreeId : "";

    if (Constants.MODES_SKELETON.includes(mode) && !this.props.isPublicViewMode) {
      return (
        <Panel header="Nodes & Trees" key="3">
          <NumberInputSetting label="Active Node ID" value={activeNodeId} onChange={this.props.onChangeActiveNodeId} />
          <NumberInputSetting label="Active Tree ID" value={activeTreeId} onChange={this.props.onChangeActiveTreeId} />
          <NumberSliderSetting label="Radius" max={5000} value={this.props.userConfiguration.radius} onChange={this.props.onChangeRadius} />
          <NumberSliderSetting label="Particle Size" max={20} step={0.1} value={this.props.userConfiguration.particleSize} onChange={this.onChangeUser.particleSize} />
          <SwitchSetting label="Soma Clicking" value={this.props.userConfiguration.newNodeNewTree} onChange={this.onChangeUser.newNodeNewTree} />
          <SwitchSetting label="Override Radius" value={this.props.userConfiguration.overrideNodeRadius} onChange={this.onChangeUser.overrideNodeRadius} />
        </Panel>
      );
    } else if (mode === Constants.MODE_VOLUME && !this.props.isPublicViewMode) {
      return (
        <Panel header="Volume Options" key="3">
          <NumberInputSetting label="Active Cell ID" value={this.state.activeCellId} onChange={this.onChangeActiveCellId} />
          <SwitchSetting label="3D Volume Rendering" value={this.props.userConfiguration.isosurfaceDisplay} onChange={this.onChangeUser.isosurfaceDisplay} />
          <NumberSliderSetting label="3D Rendering Bounding Box Size" min={1} max={10} step={0.1} value={this.props.userConfiguration.isosurfaceBBsize} onChange={this.onChangeUser.isosurfaceBBsize} />
          <NumberSliderSetting label="3D Rendering Resolution" min={40} max={400} value={this.props.userConfiguration.isosurfaceResolution} onChange={this.onChangeUser.isosurfaceResolution} />
        </Panel>
      );
    }
    return null;
  };

  render() {
    const mode = this.props.oldModel.get("mode");
    const moveValueSetting = Constants.MODES_ARBITRARY.includes(mode) ?
      <NumberSliderSetting label="Move Value (nm/s)" min={30} max={1500} step={10} value={this.props.userConfiguration.moveValue3d} onChange={this.onChangeUser.moveValue3d} /> :
      <NumberSliderSetting label="Move Value (nm/s)" min={30} max={14000} step={10} value={this.props.userConfiguration.moveValue} onChange={this.onChangeUser.moveValue} />;

    return (
      <Collapse defaultActiveKey={["1", "2", "3", "4"]}>
        <Panel header="Controls" key="1">
          <NumberSliderSetting label="Keyboard delay (ms)" min={0} max={500} value={this.props.userConfiguration.keyboardDelay} onChange={this.onChangeUser.keyboardDelay} />
          {moveValueSetting}
          <SwitchSetting label="Inverse X" value={this.props.userConfiguration.inverseX} onChange={this.onChangeUser.inverseX} />
          <SwitchSetting label="Inverse Y" value={this.props.userConfiguration.inverseY} onChange={this.onChangeUser.inverseY} />
          <SwitchSetting label="d/f-Switching" value={this.props.userConfiguration.dynamicSpaceDirection} onChange={this.onChangeUser.dynamicSpaceDirection} />
        </Panel>
        { this.getViewportOptions() }
        { this.getSkeletonOrVolumeOptions() }
        <Panel header="Other" key="4">
          <Vector6InputSetting label="Bounding Box" tooltipTitle="Format: minX, minY, minZ, width, height, depth" value={this.props.temporaryConfiguration.boundingBox} onChange={this.onChangeBoundingBox} />
          <SwitchSetting label="Display Planes in 3D View" value={this.props.userConfiguration.tdViewDisplayPlanes} onChange={this.onChangeUser.tdViewDisplayPlanes} />
        </Panel>
      </Collapse>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  userConfiguration: state.userConfiguration,
  temporaryConfiguration: state.temporaryConfiguration,
  skeletonTracing: state.skeletonTracing,
  zoomStep: state.flycam.zoomStep,
  state,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeUser(propertyName, value) { dispatch(updateUserSettingAction(propertyName, value)); },
  onChangeTemporary(propertyName, value) { dispatch(updateTemporarySettingAction(propertyName, value)); },
  onChangeActiveNodeId(id: number) { dispatch(setActiveNodeAction(id)); },
  onChangeActiveTreeId(id: number) { dispatch(setActiveTreeAction(id)); },
  onChangeZoomStep(zoomStep: number) { dispatch(setZoomStepAction(zoomStep)); },
  onChangeRadius(radius: any) {
    dispatch(updateUserSettingAction("radius", radius));
    dispatch(setActiveNodeRadiusAction(radius));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(UserSettingsView);
