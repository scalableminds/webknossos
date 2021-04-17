/**
 * tracing_settings_view.js
 * @flow
 */

import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React, { useMemo } from "react";
import _ from "lodash";

import type { APIDataset } from "types/api_flow_types";
import {
  LogSliderSetting,
  NumberInputSetting,
  NumberSliderSetting,
  SwitchSetting,
} from "oxalis/view/components/setting_input_views";
import type { UserConfiguration, OxalisState, Tracing } from "oxalis/store";
import {
  enforceSkeletonTracing,
  getActiveNode,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { getValidZoomRangeForUser } from "oxalis/model/accessors/flycam_accessor";
import { hasSegmentation } from "oxalis/model/accessors/dataset_accessor";
import {
  setActiveNodeAction,
  setActiveTreeAction,
  setNodeRadiusAction,
  setMergerModeEnabledAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { settings as settingsLabels } from "messages";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { userSettings } from "types/schemas/user_settings.schema";
import { type ControlMode, ControlModeEnum } from "oxalis/constants";

type SkeletonTabViewProps = {
  userConfiguration: UserConfiguration,
  tracing: Tracing,
  onChangeUser: (key: $Keys<UserConfiguration>, value: any) => void,
  onChangeActiveNodeId: (value: number) => void,
  onChangeActiveTreeId: (value: number) => void,
  onChangeRadius: (value: number) => void,
  onChangeEnableMergerMode: (active: boolean) => void,
  isMergerModeEnabled: boolean,
  isMergerModeTask: boolean,
  controlMode: ControlMode,
  dataset: APIDataset,
};

function SkeletonTabView(props: SkeletonTabViewProps) {
  const onChangeUser: { [$Keys<UserConfiguration>]: Function } = useMemo(
    () =>
      _.mapValues(props.userConfiguration, (__, propertyName) =>
        _.partial(props.onChangeUser, propertyName),
      ),
    [props.userConfiguration],
  );

  const isPublicViewMode = props.controlMode === ControlModeEnum.VIEW;

  if (isPublicViewMode || props.tracing.skeleton == null) {
    return null;
  }

  const skeletonTracing = enforceSkeletonTracing(props.tracing);
  const activeNodeId = skeletonTracing.activeNodeId != null ? skeletonTracing.activeNodeId : "";
  const activeTreeId = skeletonTracing.activeTreeId != null ? skeletonTracing.activeTreeId : "";
  const activeNodeRadius = getActiveNode(skeletonTracing)
    .map(activeNode => activeNode.radius)
    .getOrElse(0);
  const isMergerModeSupported = hasSegmentation(props.dataset);

  return (
    <div className="padded-tab-content" style={{ minWidth: 200 }}>
      <NumberInputSetting
        labelSpan={12}
        label="Active Node ID"
        value={activeNodeId}
        onChange={props.onChangeActiveNodeId}
      />
      <NumberInputSetting
        labelSpan={12}
        label="Active Tree ID"
        value={activeTreeId}
        onChange={props.onChangeActiveTreeId}
      />
      <LogSliderSetting
        label={settingsLabels.nodeRadius}
        min={userSettings.nodeRadius.minimum}
        max={userSettings.nodeRadius.maximum}
        roundTo={0}
        value={activeNodeRadius}
        onChange={props.onChangeRadius}
        disabled={props.userConfiguration.overrideNodeRadius || activeNodeRadius === 0}
      />
      <NumberSliderSetting
        label={
          props.userConfiguration.overrideNodeRadius
            ? settingsLabels.particleSize
            : `Min. ${settingsLabels.particleSize}`
        }
        min={userSettings.particleSize.minimum}
        max={userSettings.particleSize.maximum}
        step={0.1}
        roundTo={1}
        value={props.userConfiguration.particleSize}
        onChange={onChangeUser.particleSize}
      />
      <NumberSliderSetting
        label={settingsLabels.clippingDistanceArbitrary}
        min={userSettings.clippingDistanceArbitrary.minimum}
        max={userSettings.clippingDistanceArbitrary.maximum}
        value={props.userConfiguration.clippingDistanceArbitrary}
        onChange={onChangeUser.clippingDistanceArbitrary}
      />
      <SwitchSetting
        labelSpan={12}
        label={settingsLabels.overrideNodeRadius}
        value={props.userConfiguration.overrideNodeRadius}
        onChange={onChangeUser.overrideNodeRadius}
      />
      <SwitchSetting
        labelSpan={12}
        label={settingsLabels.newNodeNewTree}
        value={props.userConfiguration.newNodeNewTree}
        onChange={onChangeUser.newNodeNewTree}
      />
      <SwitchSetting
        labelSpan={12}
        label={settingsLabels.centerNewNode}
        value={props.userConfiguration.centerNewNode}
        onChange={onChangeUser.centerNewNode}
      />
      <SwitchSetting
        labelSpan={12}
        label={settingsLabels.highlightCommentedNodes}
        value={props.userConfiguration.highlightCommentedNodes}
        onChange={onChangeUser.highlightCommentedNodes}
      />
      <SwitchSetting
        labelSpan={12}
        label={settingsLabels.mergerMode}
        value={props.isMergerModeEnabled}
        onChange={props.onChangeEnableMergerMode}
        disabled={!isMergerModeSupported || props.isMergerModeTask}
        tooltipText={
          !isMergerModeSupported
            ? "The merger mode is only available for datasets with a segmentation layer."
            : null
        }
      />
    </div>
  );
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
  onChangeRadius(radius: number) {
    dispatch(setNodeRadiusAction(radius));
  },
  onChangeEnableMergerMode(active: boolean) {
    dispatch(setMergerModeEnabledAction(active));
  },
});

export default connect<SkeletonTabViewProps, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(SkeletonTabView);
