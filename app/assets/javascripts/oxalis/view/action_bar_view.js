// @flow
import * as React from "react";
import { Icon, Alert, Dropdown, Menu } from "antd";
import { connect } from "react-redux";
import Store from "oxalis/store";
import { setStoredLayoutsAction } from "oxalis/model/actions/ui_actions";
import { layoutEmitter, getLayoutConfigs } from "oxalis/view/layouting/layout_persistence";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import TracingActionsView, { ResetLayoutItem } from "oxalis/view/action-bar/tracing_actions_view";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import Constants, { ControlModeEnum } from "oxalis/constants";
import type { Mode, ControlMode } from "oxalis/constants";
import type { OxalisState, Tracing } from "oxalis/store";
import ButtonComponent from "oxalis/view/components/button_component";

const VersionRestoreWarning = (
  <Alert
    message="Read-only version restore mode active!"
    style={{ padding: "4px 15px" }}
    type="info"
  />
);

type StateProps = {
  viewMode: Mode,
  controlMode: ControlMode,
  tracing: Tracing,
  showVersionRestore: boolean,
};

type Props = StateProps & {
  storedLayoutsForViewMode: Object,
  setCurrentLayout: string => void,
};
// eslint-disable-next-line react/prefer-stateless-function
class ActionBarView extends React.PureComponent<Props> {
  handleResetLayout = () => {
    Store.dispatch(updateUserSettingAction("layoutScaleValue", 1));
    layoutEmitter.emit("resetLayout");
  };

  handleLayoutSelected = (layoutName: string) => {
    console.log("changing to layout:", layoutName);
  };

  handleLayoutDeleted = (layoutName: string) => {
    console.log("deleting layout:", layoutName);
  };

  handleAddingNewLayout = () => {
    // open popup/modal here to get the name
    // and add another layout with the current layout settings
    console.log("to be implemented");
  };

  render() {
    const isTraceMode = this.props.controlMode === ControlModeEnum.TRACE;
    const hasVolume = this.props.tracing.volume != null;
    const hasSkeleton = this.props.tracing.skeleton != null;
    const isVolumeSupported = !Constants.MODES_ARBITRARY.includes(this.props.viewMode);
    console.log(this.props.storedLayouts);
    const layouts = getLayoutConfigs();
    console.log(layouts);
    const resetItemProps = {
      customLayouts: { Layout1: "options", Layout2: "options" },
      onResetLayout: this.handleResetLayout,
      onSelectLayout: this.handleLayoutSelected,
      onDeleteLayout: this.handleLayoutDeleted,
      addNewLayout: this.handleAddingNewLayout,
    };
    const readonlyDropdown = (
      <Dropdown overlay={<Menu>{<ResetLayoutItem {...resetItemProps} />}</Menu>}>
        <ButtonComponent>
          <Icon type="down" />
        </ButtonComponent>
      </Dropdown>
    );

    return (
      <div className="action-bar">
        {isTraceMode && !this.props.showVersionRestore ? (
          <TracingActionsView {...resetItemProps} />
        ) : (
          readonlyDropdown
        )}
        {this.props.showVersionRestore ? VersionRestoreWarning : null}
        <DatasetPositionView />
        {hasVolume && isVolumeSupported ? <VolumeActionsView /> : null}
        {hasSkeleton && isTraceMode ? <ViewModesView /> : null}
      </div>
    );
  }
}
const mapStateToProps = (state: OxalisState): StateProps => ({
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
  tracing: state.tracing,
  showVersionRestore: state.uiInformation.showVersionRestore,
  storedLayouts: state.uiInformation.storedLayouts,
});

export default connect(mapStateToProps)(ActionBarView);
