// @flow
import React from "react";
import type Model from "oxalis/model";
import DatasetActionsView from "oxalis/view/action-bar/dataset_actions_view";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import SkeletonActionsView from "oxalis/view/action-bar/skeleton_actions_view";
import Constants from "oxalis/constants";
import { Button } from "antd";

function ActionBarView({ oldModel }: { oldModel: Model }) {
  const isTraceMode = oldModel.get("controlMode") === Constants.CONTROL_MODE_TRACE;
  const isVolumeMode = oldModel.get("mode") === Constants.MODE_VOLUME;
  const hasAdvancedOptions = oldModel.settings.advancedOptionsAllowed;

  return (
    <div className="container-fluid">
      {
        (isTraceMode && hasAdvancedOptions) ?
          <Button
            id="menu-toggle-button"
            data-toggle="offcanvas"
            data-target="#settings-menu-wrapper"
            data-canvas="#sliding-canvas"
            data-placement="left"
            data-autohide="false"
            data-disable-scrolling="false"
            icon="menu-unfold"
          >Menu</Button> :
          null
      }
      { isTraceMode ? <DatasetActionsView oldModel={oldModel} /> : null }
      { hasAdvancedOptions ? <DatasetPositionView oldModel={oldModel} /> : null }
      { isVolumeMode && hasAdvancedOptions ? <VolumeActionsView oldModel={oldModel} /> : null }
      {
        isTraceMode && hasAdvancedOptions ?
          <div>
            <ViewModesView oldModel={oldModel} />
            <SkeletonActionsView oldModel={oldModel} />
          </div> :
          null
      }
    </div>
  );
}

export default ActionBarView;
