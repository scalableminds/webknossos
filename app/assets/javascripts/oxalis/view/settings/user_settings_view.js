/**
 * tracing_settings_view.js
 * @flow
 */

import _ from "lodash";
import React, { PureComponent } from "react";
import { connect } from "react-redux";
import { Collapse } from "antd";
import type { ControlModeType, Vector6, ModeType } from "oxalis/constants";
import Constants, { ControlModeEnum } from "oxalis/constants";
import { updateUserSettingAction, updateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import { setActiveNodeAction, setActiveTreeAction, setActiveNodeRadiusAction } from "oxalis/model/actions/skeletontracing_actions";
import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import { NumberInputSetting, SwitchSetting, NumberSliderSetting, Vector6InputSetting, LogSliderSetting } from "oxalis/view/settings/setting_input_views";
import { getMaxZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import type { UserConfigurationType, TemporaryConfigurationType, OxalisState, TracingType } from "oxalis/store";
import type { Dispatch } from "redux";

const Panel = Collapse.Panel;

type UserSettingsViewProps = {
  userConfiguration: UserConfigurationType,
  temporaryConfiguration: TemporaryConfigurationType,
  tracing: TracingType,
  zoomStep: number,
  state: OxalisState,
  onChangeUser: (key: $Keys<UserConfigurationType>, value: any) => void,
  onChangeTemporary: (key: $Keys<TemporaryConfigurationType>, value: any) => void,
  onChangeActiveNodeId: (value: number) => void,
  onChangeActiveTreeId: (value: number) => void,
  onChangeActiveCellId: (value: number) => void,
  onChangeRadius: (value: number) => void,
  onChangeZoomStep: (value: number) => void,
  viewMode: ModeType,
  controlMode: ControlModeType,
};

class UserSettingsView extends PureComponent {

  props: UserSettingsViewProps;
  onChangeUser: {[$Keys<UserConfigurationType>]: Function};
  onChangeTemporary: {[$Keys<TemporaryConfigurationType>]: Function};

  componentWillMount() {
    // cache onChange handler
    this.onChangeUser = _.mapValues(this.props.userConfiguration, (__, propertyName) =>
      _.partial(this.props.onChangeUser, propertyName),
    );
  }

  onChangeBoundingBox = (boundingBox: Vector6) => {
    this.props.onChangeTemporary("userBoundingBox", boundingBox);
  }

  getViewportOptions = () => {
    switch (this.props.viewMode) {
      case Constants.MODE_PLANE_TRACING:
        return (
          <Panel header="Viewport Options" key="2">
            <LogSliderSetting label="Zoom" roundTo={3} min={0.001} max={getMaxZoomStep(this.props.state)} value={this.props.zoomStep} onChange={this.props.onChangeZoomStep} />
            <LogSliderSetting label="Viewport Scale" roundTo={3} min={Constants.MIN_SCALE} max={Constants.MAX_SCALE} step={0.1} value={this.props.userConfiguration.scale} onChange={this.onChangeUser.scale} />
            <LogSliderSetting label="Clipping Distance" roundTo={3} min={1} max={12000} value={this.props.userConfiguration.clippingDistance} onChange={this.onChangeUser.clippingDistance} />
            <SwitchSetting label="Show Crosshairs" value={this.props.userConfiguration.displayCrosshair} onChange={this.onChangeUser.displayCrosshair} />
          </Panel>
        );
      case Constants.MODE_VOLUME:
        return (
          <Panel header="Viewport Options" key="2">
            <LogSliderSetting label="Zoom" roundTo={3} min={0.1} max={getMaxZoomStep(this.props.state)} value={this.props.zoomStep} onChange={this.props.onChangeZoomStep} />
            <LogSliderSetting label="Viewport Scale" roundTo={3} min={0.05} max={20} step={0.1} value={this.props.userConfiguration.scale} onChange={this.onChangeUser.scale} />
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
    const mode = this.props.viewMode;
    const isPublicViewMode = this.props.controlMode !== ControlModeEnum.VIEW;

    if (Constants.MODES_SKELETON.includes(mode) && !isPublicViewMode && this.props.tracing.type === "skeleton") {
      const activeNodeId = this.props.tracing.activeNodeId != null ? this.props.tracing.activeNodeId : "";
      const activeTreeId = this.props.tracing.activeTreeId != null ? this.props.tracing.activeTreeId : "";
      return (
        <Panel header="Nodes & Trees" key="3">
          <NumberInputSetting label="Active Node ID" value={activeNodeId} onChange={this.props.onChangeActiveNodeId} />
          <NumberInputSetting label="Active Tree ID" value={activeTreeId} onChange={this.props.onChangeActiveTreeId} />
          <LogSliderSetting label="Node Radius" min={1} max={5000} roundTo={0} value={this.props.userConfiguration.radius} onChange={this.props.onChangeRadius} disabled={this.props.userConfiguration.overrideNodeRadius} />
          <NumberSliderSetting label={this.props.userConfiguration.overrideNodeRadius ? "Particle Size" : "Min. Particle Size"} max={20} step={0.1} value={this.props.userConfiguration.particleSize} onChange={this.onChangeUser.particleSize} />
          <SwitchSetting label="Override Node Radius" value={this.props.userConfiguration.overrideNodeRadius} onChange={this.onChangeUser.overrideNodeRadius} />
          <SwitchSetting label="Soma Clicking" value={this.props.userConfiguration.newNodeNewTree} onChange={this.onChangeUser.newNodeNewTree} />
        </Panel>
      );
    } else if (mode === Constants.MODE_VOLUME && !this.props.isPublicViewMode && this.props.tracing.type === "volume") {
      return (
        <Panel header="Volume Options" key="3">
          <NumberInputSetting label="Active Cell ID" value={this.props.tracing.activeCellId} onChange={this.props.onChangeActiveCellId} />
          <SwitchSetting label="3D Volume Rendering" value={this.props.userConfiguration.isosurfaceDisplay} onChange={this.onChangeUser.isosurfaceDisplay} />
          <NumberSliderSetting label="3D Rendering Bounding Box Size" min={1} max={10} step={0.1} value={this.props.userConfiguration.isosurfaceBBsize} onChange={this.onChangeUser.isosurfaceBBsize} />
          <NumberSliderSetting label="3D Rendering Resolution" min={40} max={400} value={this.props.userConfiguration.isosurfaceResolution} onChange={this.onChangeUser.isosurfaceResolution} />
        </Panel>
      );
    }
    return null;
  };

  render() {
    const moveValueSetting = Constants.MODES_ARBITRARY.includes(this.props.viewMode) ?
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
          <Vector6InputSetting label="Bounding Box" tooltipTitle="Format: minX, minY, minZ, width, height, depth" value={this.props.temporaryConfiguration.userBoundingBox} onChange={this.onChangeBoundingBox} />
          <SwitchSetting label="Display Planes in 3D View" value={this.props.userConfiguration.tdViewDisplayPlanes} onChange={this.onChangeUser.tdViewDisplayPlanes} />
        </Panel>
      </Collapse>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  userConfiguration: state.userConfiguration,
  temporaryConfiguration: state.temporaryConfiguration,
  tracing: state.tracing,
  zoomStep: state.flycam.zoomStep,
  state,
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeUser(propertyName, value) { dispatch(updateUserSettingAction(propertyName, value)); },
  onChangeTemporary(propertyName, value) { dispatch(updateTemporarySettingAction(propertyName, value)); },
  onChangeActiveNodeId(id: number) { dispatch(setActiveNodeAction(id)); },
  onChangeActiveTreeId(id: number) { dispatch(setActiveTreeAction(id)); },
  onChangeActiveCellId(id: number) { dispatch(setActiveCellAction(id)); },
  onChangeZoomStep(zoomStep: number) { dispatch(setZoomStepAction(zoomStep)); },
  onChangeRadius(radius: any) {
    dispatch(updateUserSettingAction("radius", radius));
    dispatch(setActiveNodeRadiusAction(radius));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(UserSettingsView);
