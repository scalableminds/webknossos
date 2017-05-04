// @flow
import React from "react";
import DatasetActionsView from "oxalis/view/action-bar/dataset_actions_view";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import Constants, { ControlModeEnum } from "oxalis/constants";
import Store from "oxalis/store";
import { Menu } from "antd";

const MenuItem = Menu.Item;

function ActionBarView() {
  const temporaryConfiguration = Store.getState().temporaryConfiguration;
  const isTraceMode = temporaryConfiguration.controlMode === ControlModeEnum.TRACE;
  const isVolumeMode = temporaryConfiguration.viewMode === Constants.MODE_VOLUME;
  const hasAdvancedOptions = Store.getState().tracing.restrictions.advancedOptionsAllowed;

  return (
    <Menu mode="horizontal">
      { isTraceMode ? <MenuItem><DatasetActionsView /></MenuItem> : null }
      { hasAdvancedOptions ? <MenuItem><DatasetPositionView /></MenuItem> : null }
      { isVolumeMode && hasAdvancedOptions ? <MenuItem><VolumeActionsView /></MenuItem> : null }
      { !isVolumeMode && isTraceMode && hasAdvancedOptions ? <MenuItem><ViewModesView /></MenuItem> : null }
    </Menu>
  );
}

export default ActionBarView;
