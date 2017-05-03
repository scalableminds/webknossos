// @flow
import React from "react";
import Model from "oxalis/model";
import DatasetActionsView from "oxalis/view/action-bar/dataset_actions_view";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import Constants from "oxalis/constants";
import Store from "oxalis/store";
import { Menu } from "antd";

const MenuItem = Menu.Item;


function ActionBarView() {
  const isTraceMode = Model.controlMode === Constants.CONTROL_MODE_TRACE;
  const isVolumeMode = Store.getState().temporaryConfiguration.viewMode === Constants.MODE_VOLUME;
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
