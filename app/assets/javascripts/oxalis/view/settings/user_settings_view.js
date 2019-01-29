/**

 * tracing_settings_view.js
 * @flow
 */

import { Collapse } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React, { PureComponent } from "react";
import _ from "lodash";

import {
  NumberInputSetting,
  SwitchSetting,
  NumberSliderSetting,
  Vector6InputSetting,
  LogSliderSetting,
} from "oxalis/view/settings/setting_input_views";
import type { UserConfiguration, OxalisState, Tracing } from "oxalis/store";
import {
  enforceSkeletonTracing,
  getActiveNode,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { getMaxZoomStep } from "oxalis/model/accessors/dataset_accessor";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import {
  setActiveCellAction,
  setBrushSizeAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  setActiveNodeAction,
  setActiveTreeAction,
  setNodeRadiusAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import { setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Constants, {
  type ControlMode,
  ControlModeEnum,
  type Mode,
  type Vector6,
} from "oxalis/constants";
import * as Utils from "libs/utils";
import { enableMergerMode, disableMergerMode } from "oxalis/merger_mode";
import { settings } from "messages";
import MergerModeModalView from "./merger_mode_modal_view";

const Panel = Collapse.Panel;

type UserSettingsViewProps = {
  userConfiguration: UserConfiguration,
  tracing: Tracing,
  zoomStep: number,
  maxZoomStep: number,
  onChangeUser: (key: $Keys<UserConfiguration>, value: any) => void,
  onChangeActiveNodeId: (value: number) => void,
  onChangeActiveTreeId: (value: number) => void,
  onChangeActiveCellId: (value: number) => void,
  onChangeBoundingBox: (value: ?Vector6) => void,
  onChangeRadius: (value: number) => void,
  onChangeZoomStep: (value: number) => void,
  onChangeBrushSize: (value: number) => void,
  viewMode: Mode,
  controlMode: ControlMode,
  brushSize: number,
};

type State = {
  isMergerModeEnabled: boolean,
  isMergerModeModalVisible: boolean,
  isMergerModeModalClosable: boolean,
};

class UserSettingsView extends PureComponent<UserSettingsViewProps, State> {
  onChangeUser: { [$Keys<UserConfiguration>]: Function };
  state = {
    isMergerModeEnabled: false,
    isMergerModeModalVisible: false,
    isMergerModeModalClosable: false,
  };

  componentWillMount() {
    // cache onChange handler
    this.onChangeUser = _.mapValues(this.props.userConfiguration, (__, propertyName) =>
      _.partial(this.props.onChangeUser, propertyName),
    );
  }

  handleMergerModeChange = async value => {
    if (value) {
      this.setState({
        isMergerModeEnabled: true,
        isMergerModeModalVisible: true,
        isMergerModeModalClosable: false,
      });
      await enableMergerMode();
      // The modal is only closeable after the merger mode is fully enabled
      // and finished preprocessing
      this.setState({ isMergerModeModalClosable: true });
    } else {
      this.setState({
        isMergerModeEnabled: false,
        isMergerModeModalVisible: false,
        isMergerModeModalClosable: false,
      });
      disableMergerMode();
    }
  };

  getViewportOptions = () => {
    switch (this.props.viewMode) {
      case Constants.MODE_PLANE_TRACING:
        return (
          <Panel header="Viewport Options" key="2">
            <LogSliderSetting
              label="Zoom"
              roundTo={3}
              min={0.001}
              max={this.props.maxZoomStep}
              value={this.props.zoomStep}
              onChange={this.props.onChangeZoomStep}
            />
            <LogSliderSetting
              label={settings.clippingDistance}
              roundTo={3}
              min={1}
              max={12000}
              value={this.props.userConfiguration.clippingDistance}
              onChange={this.onChangeUser.clippingDistance}
            />
            <SwitchSetting
              label={settings.displayCrosshair}
              value={this.props.userConfiguration.displayCrosshair}
              onChange={this.onChangeUser.displayCrosshair}
            />
            <SwitchSetting
              label={settings.displayScalebars}
              value={this.props.userConfiguration.displayScalebars}
              onChange={this.onChangeUser.displayScalebars}
            />
          </Panel>
        );
      case Constants.MODE_VOLUME:
        return (
          <Panel header="Viewport Options" key="2">
            <LogSliderSetting
              label={settings.zoom}
              roundTo={3}
              min={0.1}
              max={this.props.maxZoomStep}
              value={this.props.zoomStep}
              onChange={this.props.onChangeZoomStep}
            />
            <SwitchSetting
              label={settings.displayCrosshair}
              value={this.props.userConfiguration.displayCrosshair}
              onChange={this.onChangeUser.displayCrosshair}
            />
            <SwitchSetting
              label={settings.displayScalebars}
              value={this.props.userConfiguration.displayScalebars}
              onChange={this.onChangeUser.displayScalebars}
            />
          </Panel>
        );
      default:
        return (
          <Panel header="Flight Options" key="2">
            <LogSliderSetting
              label={settings.zoom}
              roundTo={3}
              min={0.001}
              max={this.props.maxZoomStep}
              value={this.props.zoomStep}
              onChange={this.props.onChangeZoomStep}
            />
            <NumberSliderSetting
              label={settings.mouseRotateValue}
              min={0.0001}
              max={0.02}
              step={0.001}
              value={this.props.userConfiguration.mouseRotateValue}
              onChange={this.onChangeUser.mouseRotateValue}
            />
            <NumberSliderSetting
              label={settings.rotateValue}
              min={0.001}
              max={0.08}
              step={0.001}
              value={this.props.userConfiguration.rotateValue}
              onChange={this.onChangeUser.rotateValue}
            />
            <NumberSliderSetting
              label={settings.crosshairSize}
              min={0.05}
              max={0.5}
              step={0.01}
              value={this.props.userConfiguration.crosshairSize}
              onChange={this.onChangeUser.crosshairSize}
            />
            <NumberSliderSetting
              label={settings.sphericalCapRadius}
              min={50}
              max={500}
              step={1}
              value={this.props.userConfiguration.sphericalCapRadius}
              onChange={this.onChangeUser.sphericalCapRadius}
            />
            <NumberSliderSetting
              label={settings.clippingDistanceArbitrary}
              max={127}
              value={this.props.userConfiguration.clippingDistanceArbitrary}
              onChange={this.onChangeUser.clippingDistanceArbitrary}
            />
            <SwitchSetting
              label={settings.displayCrosshair}
              value={this.props.userConfiguration.displayCrosshair}
              onChange={this.onChangeUser.displayCrosshair}
            />
          </Panel>
        );
    }
  };

  getSkeletonOrVolumeOptions = () => {
    const isPublicViewMode = this.props.controlMode === ControlModeEnum.VIEW;

    if (isPublicViewMode) {
      return null;
    }

    const panels = [];

    if (this.props.tracing.skeleton != null) {
      const skeletonTracing = enforceSkeletonTracing(this.props.tracing);
      const activeNodeId = skeletonTracing.activeNodeId != null ? skeletonTracing.activeNodeId : "";
      const activeTreeId = skeletonTracing.activeTreeId != null ? skeletonTracing.activeTreeId : "";
      const activeNodeRadius = getActiveNode(skeletonTracing)
        .map(activeNode => activeNode.radius)
        .getOrElse(0);
      panels.push(
        <Panel header="Nodes & Trees" key="3a">
          <NumberInputSetting
            label="Active Node ID"
            value={activeNodeId}
            onChange={this.props.onChangeActiveNodeId}
          />
          <NumberInputSetting
            label="Active Tree ID"
            value={activeTreeId}
            onChange={this.props.onChangeActiveTreeId}
          />
          <LogSliderSetting
            label="Node Radius"
            min={Constants.MIN_NODE_RADIUS}
            max={Constants.MAX_NODE_RADIUS}
            roundTo={0}
            value={activeNodeRadius}
            onChange={this.props.onChangeRadius}
            disabled={this.props.userConfiguration.overrideNodeRadius || activeNodeRadius === 0}
          />
          <NumberSliderSetting
            label={
              this.props.userConfiguration.overrideNodeRadius
                ? settings.particleSize
                : `Min. ${settings.particleSize}`
            }
            min={Constants.MIN_PARTICLE_SIZE}
            max={Constants.MAX_PARTICLE_SIZE}
            step={0.1}
            roundTo={1}
            value={this.props.userConfiguration.particleSize}
            onChange={this.onChangeUser.particleSize}
          />
          <SwitchSetting
            label={settings.overrideNodeRadius}
            value={this.props.userConfiguration.overrideNodeRadius}
            onChange={this.onChangeUser.overrideNodeRadius}
          />
          <SwitchSetting
            label={settings.newNodeNewTree}
            value={this.props.userConfiguration.newNodeNewTree}
            onChange={this.onChangeUser.newNodeNewTree}
          />
          <SwitchSetting
            label={settings.highlightCommentedNodes}
            value={this.props.userConfiguration.highlightCommentedNodes}
            onChange={this.onChangeUser.highlightCommentedNodes}
          />
          <SwitchSetting
            label="Enable Merger Mode"
            value={this.state.isMergerModeEnabled}
            onChange={value => {
              this.handleMergerModeChange(value);
            }}
          />
        </Panel>,
      );
    }

    if (this.props.tracing.volume != null) {
      const volumeTracing = enforceVolumeTracing(this.props.tracing);
      panels.push(
        <Panel header="Volume Options" key="3b">
          <LogSliderSetting
            label={settings.brushSize}
            roundTo={0}
            min={Constants.MIN_BRUSH_SIZE}
            max={Constants.MAX_BRUSH_SIZE}
            step={5}
            value={this.props.brushSize}
            onChange={this.props.onChangeBrushSize}
          />
          <NumberInputSetting
            label="Active Cell ID"
            value={volumeTracing.activeCellId}
            onChange={this.props.onChangeActiveCellId}
          />
        </Panel>,
      );
    }
    return panels;
  };

  render() {
    const { isMergerModeModalVisible, isMergerModeModalClosable } = this.state;
    const moveValueSetting = Constants.MODES_ARBITRARY.includes(this.props.viewMode) ? (
      <NumberSliderSetting
        label={settings.moveValue3d}
        min={30}
        max={1500}
        step={10}
        value={this.props.userConfiguration.moveValue3d}
        onChange={this.onChangeUser.moveValue3d}
      />
    ) : (
      <NumberSliderSetting
        label={settings.moveValue}
        min={30}
        max={14000}
        step={10}
        value={this.props.userConfiguration.moveValue}
        onChange={this.onChangeUser.moveValue}
      />
    );

    return (
      <React.Fragment>
        <Collapse defaultActiveKey={["1", "2", "3a", "3b", "4"]}>
          <Panel header="Controls" key="1">
            <NumberSliderSetting
              label={settings.keyboardDelay}
              min={0}
              max={500}
              value={this.props.userConfiguration.keyboardDelay}
              onChange={this.onChangeUser.keyboardDelay}
            />
            {moveValueSetting}
            <SwitchSetting
              label={settings.dynamicSpaceDirection}
              value={this.props.userConfiguration.dynamicSpaceDirection}
              onChange={this.onChangeUser.dynamicSpaceDirection}
            />
          </Panel>
          {this.getViewportOptions()}
          {this.getSkeletonOrVolumeOptions()}
          <Panel header="Other" key="4">
            <Vector6InputSetting
              label={settings.userBoundingBox}
              tooltipTitle="Format: minX, minY, minZ, width, height, depth"
              value={Utils.computeArrayFromBoundingBox(
                getSomeTracing(this.props.tracing).userBoundingBox,
              )}
              onChange={this.props.onChangeBoundingBox}
            />
            <SwitchSetting
              label={settings.tdViewDisplayPlanes}
              value={this.props.userConfiguration.tdViewDisplayPlanes}
              onChange={this.onChangeUser.tdViewDisplayPlanes}
            />
          </Panel>
        </Collapse>
        {isMergerModeModalVisible ? (
          <MergerModeModalView
            isCloseable={isMergerModeModalClosable}
            onClose={() => this.setState({ isMergerModeModalVisible: false })}
          />
        ) : null}
      </React.Fragment>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  userConfiguration: state.userConfiguration,
  tracing: state.tracing,
  zoomStep: state.flycam.zoomStep,
  maxZoomStep: getMaxZoomStep(state.dataset),
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
  brushSize: state.temporaryConfiguration.brushSize,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeUser(propertyName, value) {
    dispatch(updateUserSettingAction(propertyName, value));
  },
  onChangeActiveNodeId(id: number) {
    dispatch(setActiveNodeAction(id));
  },
  onChangeActiveTreeId(id: number) {
    dispatch(setActiveTreeAction(id));
  },
  onChangeActiveCellId(id: number) {
    dispatch(setActiveCellAction(id));
  },
  onChangeBrushSize(size: number) {
    dispatch(setBrushSizeAction(size));
  },
  onChangeBoundingBox(boundingBox: ?Vector6) {
    dispatch(setUserBoundingBoxAction(Utils.computeBoundingBoxFromArray(boundingBox)));
  },
  onChangeZoomStep(zoomStep: number) {
    dispatch(setZoomStepAction(zoomStep));
  },
  onChangeRadius(radius: number) {
    dispatch(setNodeRadiusAction(radius));
  },
});

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(UserSettingsView);
