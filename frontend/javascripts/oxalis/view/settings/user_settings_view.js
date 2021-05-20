/**
 * tracing_settings_view.js
 * @flow
 */

import features from "features";
import { Collapse, Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React, { PureComponent } from "react";
import _ from "lodash";

import type { APIDataset } from "types/api_flow_types";
import {
  LogSliderSetting,
  NumberInputSetting,
  NumberSliderSetting,
  SwitchSetting,
  UserBoundingBoxInput,
  type UserBoundingBoxInputUpdate,
} from "oxalis/view/settings/setting_input_views";
import type { UserConfiguration, OxalisState, Tracing, UserBoundingBox } from "oxalis/store";
import {
  enforceSkeletonTracing,
  getActiveNode,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { getValidZoomRangeForUser } from "oxalis/model/accessors/flycam_accessor";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { hasSegmentation, getDatasetExtentInVoxel } from "oxalis/model/accessors/dataset_accessor";
import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import {
  setActiveNodeAction,
  setActiveTreeAction,
  setNodeRadiusAction,
  setMergerModeEnabledAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setUserBoundingBoxesAction } from "oxalis/model/actions/annotation_actions";
import { setZoomStepAction } from "oxalis/model/actions/flycam_actions";
import { settings as settingsLabels } from "messages";
import {
  updateTemporarySettingAction,
  updateUserSettingAction,
} from "oxalis/model/actions/settings_actions";
import { userSettings } from "types/schemas/user_settings.schema";
import Constants, { type ControlMode, ControlModeEnum, type ViewMode } from "oxalis/constants";
import Toast from "libs/toast";
import * as Utils from "libs/utils";

import ExportBoundingBoxModal from "oxalis/view/settings/export_bounding_box_modal";

const { Panel } = Collapse;

type UserSettingsViewProps = {
  userConfiguration: UserConfiguration,
  tracing: Tracing,
  zoomStep: number,
  validZoomRange: [number, number],
  onChangeUser: (key: $Keys<UserConfiguration>, value: any) => void,
  onChangeActiveNodeId: (value: number) => void,
  onChangeActiveTreeId: (value: number) => void,
  onChangeActiveCellId: (value: number) => void,
  onChangeBoundingBoxes: (value: Array<UserBoundingBox>) => void,
  onChangeRadius: (value: number) => void,
  onChangeZoomStep: (value: number) => void,
  onChangeEnableMergerMode: (active: boolean) => void,
  onChangeEnableAutoBrush: (active: boolean) => void,
  isMergerModeEnabled: boolean,
  isMergerModeTask: boolean,
  isAutoBrushEnabled: boolean,
  viewMode: ViewMode,
  controlMode: ControlMode,
  dataset: APIDataset,
};

type State = {
  exportBoundingBoxModalId: ?number,
};

class UserSettingsView extends PureComponent<UserSettingsViewProps, State> {
  onChangeUser: { [$Keys<UserConfiguration>]: Function };
  state = { exportBoundingBoxModalId: null };

  componentWillMount() {
    // cache onChange handler
    this.onChangeUser = _.mapValues(this.props.userConfiguration, (__, propertyName) =>
      _.partial(this.props.onChangeUser, propertyName),
    );
  }

  handleAutoBrushChange = async (active: boolean) => {
    this.props.onChangeEnableAutoBrush(active);
    if (active) {
      Toast.info(
        "You enabled the experimental automatic brush feature. Activate the brush tool and use CTRL+Click to use it.",
      );
    }
  };

  handleChangeUserBoundingBox = (
    id: number,
    { boundingBox, name, color, isVisible }: UserBoundingBoxInputUpdate,
  ) => {
    const maybeUpdatedBoundingBox = boundingBox
      ? Utils.computeBoundingBoxFromArray(boundingBox)
      : undefined;
    const { userBoundingBoxes } = getSomeTracing(this.props.tracing);

    const updatedUserBoundingBoxes = userBoundingBoxes.map(bb =>
      bb.id === id
        ? {
            ...bb,
            boundingBox: maybeUpdatedBoundingBox || bb.boundingBox,
            name: name != null ? name : bb.name,
            color: color || bb.color,
            isVisible: isVisible != null ? isVisible : bb.isVisible,
          }
        : bb,
    );
    this.props.onChangeBoundingBoxes(updatedUserBoundingBoxes);
  };

  handleAddNewUserBoundingBox = () => {
    const { userBoundingBoxes } = getSomeTracing(this.props.tracing);
    const datasetBoundingBox = getDatasetExtentInVoxel(this.props.dataset);
    // We use the default of -1 to get the id 0 for the first user bounding box.
    const highestBoundingBoxId = Math.max(-1, ...userBoundingBoxes.map(bb => bb.id));
    const boundingBoxId = highestBoundingBoxId + 1;
    const newUserBoundingBox = {
      boundingBox: Utils.computeBoundingBoxFromBoundingBoxObject(datasetBoundingBox),
      id: boundingBoxId,
      name: `user bounding box ${boundingBoxId}`,
      color: Utils.getRandomColor(),
      isVisible: true,
    };
    const updatedUserBoundingBoxes = [...userBoundingBoxes, newUserBoundingBox];
    this.props.onChangeBoundingBoxes(updatedUserBoundingBoxes);
  };

  handleDeleteUserBoundingBox = (id: number) => {
    const { userBoundingBoxes } = getSomeTracing(this.props.tracing);
    const updatedUserBoundingBoxes = userBoundingBoxes.filter(boundingBox => boundingBox.id !== id);
    this.props.onChangeBoundingBoxes(updatedUserBoundingBoxes);
  };

  handleExportUserBoundingBox = (id: number) => {
    this.setState({ exportBoundingBoxModalId: id });
  };

  getViewportOptions = () => {
    switch (this.props.viewMode) {
      case Constants.MODE_PLANE_TRACING:
        return (
          <Panel header="Viewport Options" key="2">
            <LogSliderSetting
              label={settingsLabels.zoom}
              roundTo={3}
              min={this.props.validZoomRange[0]}
              max={this.props.validZoomRange[1]}
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
              min={this.props.validZoomRange[0]}
              max={this.props.validZoomRange[1]}
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
              min={this.props.validZoomRange[0]}
              max={this.props.validZoomRange[1]}
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
      const isMergerModeSupported = hasSegmentation(this.props.dataset);
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
            label={settingsLabels.centerNewNode}
            value={this.props.userConfiguration.centerNewNode}
            onChange={this.onChangeUser.centerNewNode}
          />
          <SwitchSetting
            label={settingsLabels.highlightCommentedNodes}
            value={this.props.userConfiguration.highlightCommentedNodes}
            onChange={this.onChangeUser.highlightCommentedNodes}
          />
          <SwitchSetting
            label={settingsLabels.mergerMode}
            value={this.props.isMergerModeEnabled}
            onChange={this.props.onChangeEnableMergerMode}
            disabled={!isMergerModeSupported || this.props.isMergerModeTask}
            tooltipText={
              !isMergerModeSupported
                ? "The merger mode is only available for datasets with a segmentation layer."
                : null
            }
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
          {this.maybeGetAutoBrushUi()}
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

  maybeGetAutoBrushUi() {
    const { autoBrushReadyDatasets } = features();
    if (
      autoBrushReadyDatasets == null ||
      !autoBrushReadyDatasets.includes(this.props.dataset.name)
    ) {
      return null;
    }

    return (
      <SwitchSetting
        label={settingsLabels.autoBrush}
        value={this.props.isAutoBrushEnabled}
        onChange={value => {
          this.handleAutoBrushChange(value);
        }}
      />
    );
  }

  render() {
    const { userBoundingBoxes } = getSomeTracing(this.props.tracing);
    const exportUserBoundingBox =
      this.state.exportBoundingBoxModalId != null
        ? userBoundingBoxes.find(
            boundingBox => boundingBox.id === this.state.exportBoundingBoxModalId,
          )
        : null;

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
      <Collapse
        bordered={false}
        defaultActiveKey={["1", "2", "3a", "3b", "4"]}
        className="tracing-settings-menu"
      >
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
        <Panel header={settingsLabels.userBoundingBoxes} key="4">
          {userBoundingBoxes.map(bb => (
            <UserBoundingBoxInput
              key={bb.id}
              tooltipTitle="Format: minX, minY, minZ, width, height, depth"
              value={Utils.computeArrayFromBoundingBox(bb.boundingBox)}
              color={bb.color}
              name={bb.name}
              isVisible={bb.isVisible}
              onChange={_.partial(this.handleChangeUserBoundingBox, bb.id)}
              onDelete={_.partial(this.handleDeleteUserBoundingBox, bb.id)}
              onExport={_.partial(this.handleExportUserBoundingBox, bb.id)}
            />
          ))}
          {exportUserBoundingBox != null ? (
            <ExportBoundingBoxModal
              dataset={this.props.dataset}
              tracing={this.props.tracing}
              boundingBox={exportUserBoundingBox.boundingBox}
              destroy={() => {
                this.setState({ exportBoundingBoxModalId: null });
              }}
            />
          ) : null}
          <div style={{ display: "inline-block", width: "100%" }}>
            <Tooltip title="Click to add another bounding box.">
              <PlusOutlined
                onClick={this.handleAddNewUserBoundingBox}
                style={{
                  float: "right",
                  cursor: "pointer",
                  marginBottom: userBoundingBoxes.length === 0 ? 12 : 0,
                }}
              />
            </Tooltip>
          </div>
        </Panel>
      </Collapse>
    );
  }
}

// Reuse last range if it's equal to the current one to avoid unnecessary
// render() executions
let lastValidZoomRange = null;
function _getValidZoomRangeForUser(state) {
  const newRange = getValidZoomRangeForUser(state);

  if (
    !lastValidZoomRange ||
    newRange[0] !== lastValidZoomRange[0] ||
    newRange[1] !== lastValidZoomRange[1]
  ) {
    lastValidZoomRange = newRange;
  }
  return lastValidZoomRange;
}

const mapStateToProps = (state: OxalisState) => ({
  userConfiguration: state.userConfiguration,
  tracing: state.tracing,
  zoomStep: state.flycam.zoomStep,
  validZoomRange: _getValidZoomRangeForUser(state),
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
  isMergerModeEnabled: state.temporaryConfiguration.isMergerModeEnabled,
  isAutoBrushEnabled: state.temporaryConfiguration.isAutoBrushEnabled,
  dataset: state.dataset,
  isMergerModeTask: state.tracing.restrictions.mergerMode || false,
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
  onChangeBoundingBoxes(userBoundingBoxes: Array<UserBoundingBox>) {
    dispatch(setUserBoundingBoxesAction(userBoundingBoxes));
  },
  onChangeZoomStep(zoomStep: number) {
    dispatch(setZoomStepAction(zoomStep));
  },
  onChangeRadius(radius: number) {
    dispatch(setNodeRadiusAction(radius));
  },
  onChangeEnableMergerMode(active: boolean) {
    dispatch(setMergerModeEnabledAction(active));
  },
  onChangeEnableAutoBrush(active: boolean) {
    dispatch(updateTemporarySettingAction("isAutoBrushEnabled", active));
  },
});

export default connect<UserSettingsViewProps, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(UserSettingsView);
