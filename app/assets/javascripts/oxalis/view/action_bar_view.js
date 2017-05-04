// @flow
import React from "react";
import DatasetActionsView from "oxalis/view/action-bar/dataset_actions_view";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import Constants, { ControlModeEnum } from "oxalis/constants";
import Store from "oxalis/store";

function ActionBarView() {
  const temporaryConfiguration = Store.getState().temporaryConfiguration;
  const isTraceMode = temporaryConfiguration.controlMode === ControlModeEnum.TRACE;
  const isVolumeMode = temporaryConfiguration.viewMode === Constants.MODE_VOLUME;
  const hasAdvancedOptions = Store.getState().tracing.restrictions.advancedOptionsAllowed;

  return (
    <div className="action-bar">
      { isTraceMode ? <DatasetActionsView /> : null }
      { hasAdvancedOptions ? <DatasetPositionView /> : null }
      { isVolumeMode && hasAdvancedOptions ? <VolumeActionsView /> : null }
      { !isVolumeMode && isTraceMode && hasAdvancedOptions ? <ViewModesView /> : null }
    </div>
  );
}

export default ActionBarView;
