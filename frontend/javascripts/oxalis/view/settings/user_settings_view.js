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
import { getMaxZoomValue } from "oxalis/model/accessors/flycam_accessor";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import {
  setActiveNodeAction,
  setActiveTreeAction,
  setNodeRadiusAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import { setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import { settings as settingsLabels } from "messages";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Constants, {
  type ControlMode,
  ControlModeEnum,
  type ViewMode,
  type Vector6,
} from "oxalis/constants";
import * as Utils from "libs/utils";
import { enableMergerMode, disableMergerMode } from "oxalis/merger_mode";
import { userSettings } from "libs/user_settings.schema";
import MergerModeModalView from "./merger_mode_modal_view";

const {Panel} = Collapse;

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
  viewMode: ViewMode,
  controlMode: ControlMode,
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

  handleMergerModeChange = async (value: boolean) => {
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
              label={settingsLabels.zoom}
              roundTo={3}
              min={userSettings.zoom.minimum}
              max={this.props.maxZoomStep}
              value={this.props.zoomStep}
              onChange={this.props.onChangeZoomStep}
            />
            <LogSliderSetting
              label={settingsLabels.clippingDistance}
              roundTo={3}
              min={userSettings.clippingDistance.minimum}
              max={userSettings.clippingDistance.maximum}
              value={this.props.userConfiguration.clippingDistance}
              onChange={this.onChangeUser.clippingDistance}
            />
            <SwitchSetting
              label={settingsLabels.displayCrosshair}
              value={this.props.userConfiguration.displayCrosshair}
              onChange={this.onChangeUser.displayCrosshair}
            />
            <SwitchSetting
              label={settingsLabels.displayScalebars}
              value={this.props.userConfiguration.displayScalebars}
              onChange={this.onChangeUser.displayScalebars}
            />
          </Panel>
        );
      case Constants.MODE_VOLUME:
        return (
          <Panel header="Viewport Options" key="2">
            <LogSliderSetting
              label={settingsLabels.zoom}
              roundTo={3}
              min={userSettings.zoom.minimum}
              max={this.props.maxZoomStep}
              value={this.props.zoomStep}
              onChange={this.props.onChangeZoomStep}
            />
            <SwitchSetting
              label={settingsLabels.displayCrosshair}
              value={this.props.userConfiguration.displayCrosshair}
              onChange={this.onChangeUser.displayCrosshair}
            />
            <SwitchSetting
              label={settingsLabels.displayScalebars}
              value={this.props.userConfiguration.displayScalebars}
              onChange={this.onChangeUser.displayScalebars}
            />
          </Panel>
        );
      default:
        return (
          <Panel header="Flight Options" key="2">
            <LogSliderSetting
              label={settingsLabels.zoom}
              roundTo={3}
              min={userSettings.zoom.minimum}
              max={this.props.maxZoomStep}
              value={this.props.zoomStep}
              onChange={this.props.onChangeZoomStep}
            />
            <NumberSliderSetting
              label={settingsLabels.mouseRotateValue}
              min={userSettings.mouseRotateValue.minimum}
              max={userSettings.mouseRotateValue.maximum}
              step={0.001}
              value={this.props.userConfiguration.mouseRotateValue}
              onChange={this.onChangeUser.mouseRotateValue}
            />
            <NumberSliderSetting
              label={settingsLabels.rotateValue}
              min={userSettings.rotateValue.minimum}
              max={userSettings.rotateValue.maximum}
              step={0.001}
              value={this.props.userConfiguration.rotateValue}
              onChange={this.onChangeUser.rotateValue}
            />
            <NumberSliderSetting
              label={settingsLabels.crosshairSize}
              min={userSettings.crosshairSize.minimum}
              max={userSettings.crosshairSize.maximum}
              step={0.01}
              value={this.props.userConfiguration.crosshairSize}
              onChange={this.onChangeUser.crosshairSize}
            />
            <NumberSliderSetting
              label={settingsLabels.sphericalCapRadius}
              min={userSettings.sphericalCapRadius.minimum}
              max={userSettings.sphericalCapRadius.maximum}
              step={1}
              value={this.props.userConfiguration.sphericalCapRadius}
              onChange={this.onChangeUser.sphericalCapRadius}
            />
            <NumberSliderSetting
              label={settingsLabels.clippingDistanceArbitrary}
              min={userSettings.clippingDistanceArbitrary.minimum}
              max={userSettings.clippingDistanceArbitrary.maximum}
              value={this.props.userConfiguration.clippingDistanceArbitrary}
              onChange={this.onChangeUser.clippingDistanceArbitrary}
            />
            <SwitchSetting
              label={settingsLabels.displayCrosshair}
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
            label={settingsLabels.nodeRadius}
            min={userSettings.nodeRadius.minimum}
            max={userSettings.nodeRadius.maximum}
            roundTo={0}
            value={activeNodeRadius}
            onChange={this.props.onChangeRadius}
            disabled={this.props.userConfiguration.overrideNodeRadius || activeNodeRadius === 0}
          />
          <NumberSliderSetting
            label={
              this.props.userConfiguration.overrideNodeRadius
                ? settingsLabels.particleSize
                : `Min. ${settingsLabels.particleSize}`
            }
            min={userSettings.particleSize.minimum}
            max={userSettings.particleSize.maximum}
            step={0.1}
            roundTo={1}
            value={this.props.userConfiguration.particleSize}
            onChange={this.onChangeUser.particleSize}
          />
          <SwitchSetting
            label={settingsLabels.overrideNodeRadius}
            value={this.props.userConfiguration.overrideNodeRadius}
            onChange={this.onChangeUser.overrideNodeRadius}
          />
          <SwitchSetting
            label={settingsLabels.newNodeNewTree}
            value={this.props.userConfiguration.newNodeNewTree}
            onChange={this.onChangeUser.newNodeNewTree}
          />
          <SwitchSetting
            label={settingsLabels.highlightCommentedNodes}
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
            label={settingsLabels.brushSize}
            roundTo={0}
            min={userSettings.brushSize.minimum}
            max={userSettings.brushSize.maximum}
            step={5}
            value={this.props.userConfiguration.brushSize}
            onChange={this.onChangeUser.brushSize}
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
        label={settingsLabels.moveValue3d}
        min={userSettings.moveValue3d.minimum}
        max={userSettings.moveValue3d.maximum}
        step={10}
        value={this.props.userConfiguration.moveValue3d}
        onChange={this.onChangeUser.moveValue3d}
      />
    ) : (
      <NumberSliderSetting
        label={settingsLabels.moveValue}
        min={userSettings.moveValue.minimum}
        max={userSettings.moveValue.maximum}
        step={10}
        value={this.props.userConfiguration.moveValue}
        onChange={this.onChangeUser.moveValue}
      />
    );

    return (
      <React.Fragment>
        <Collapse bordered={false} defaultActiveKey={["1", "2", "3a", "3b", "4"]}>
          <Panel header="Controls" key="1">
            <NumberSliderSetting
              label={settingsLabels.keyboardDelay}
              min={userSettings.keyboardDelay.minimum}
              max={userSettings.keyboardDelay.maximum}
              value={this.props.userConfiguration.keyboardDelay}
              onChange={this.onChangeUser.keyboardDelay}
            />
            {moveValueSetting}
            <SwitchSetting
              label={settingsLabels.dynamicSpaceDirection}
              value={this.props.userConfiguration.dynamicSpaceDirection}
              onChange={this.onChangeUser.dynamicSpaceDirection}
            />
          </Panel>
          {this.getViewportOptions()}
          {this.getSkeletonOrVolumeOptions()}
          <Panel header="Other" key="4">
            <Vector6InputSetting
              label={settingsLabels.userBoundingBox}
              tooltipTitle="Format: minX, minY, minZ, width, height, depth"
              value={Utils.computeArrayFromBoundingBox(
                getSomeTracing(this.props.tracing).userBoundingBox,
              )}
              onChange={this.props.onChangeBoundingBox}
            />
            <SwitchSetting
              label={settingsLabels.tdViewDisplayPlanes}
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
  maxZoomStep: getMaxZoomValue(state),
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
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

export default connect<UserSettingsViewProps, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(UserSettingsView);
