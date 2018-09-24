// @flow
import * as React from "react";
import { Icon, Alert, Dropdown, Menu } from "antd";
import { connect } from "react-redux";
import TracingActionsView, { resetLayoutItem } from "oxalis/view/action-bar/tracing_actions_view";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import Constants, { ControlModeEnum } from "oxalis/constants";
import type { ModeType, ControlModeType } from "oxalis/constants";
import type { OxalisState, TracingType } from "oxalis/store";
import ButtonComponent from "oxalis/view/components/button_component";

const VersionRestoreWarning = (
  <Alert
    message="Read-only version restore mode active!"
    style={{ padding: "4px 15px" }}
    type="info"
  />
);

type Props = {
  viewMode: ModeType,
  controlMode: ControlModeType,
  tracing: TracingType,
  showVersionRestore: boolean,
};

// eslint-disable-next-line react/prefer-stateless-function
class ActionBarView extends React.PureComponent<Props> {
  render() {
    const isTraceMode = this.props.controlMode === ControlModeEnum.TRACE;
    const hasVolume = this.props.tracing.volume != null;
    const isVolumeSupported = !Constants.MODES_ARBITRARY.includes(this.props.viewMode);
    const readonlyDropdown = (
      <Dropdown overlay={<Menu>{resetLayoutItem}</Menu>}>
        <ButtonComponent>
          <Icon type="down" />
        </ButtonComponent>
      </Dropdown>
    );

    return (
      <div className="action-bar">
        {isTraceMode && !this.props.showVersionRestore ? <TracingActionsView /> : readonlyDropdown}
        {this.props.showVersionRestore ? VersionRestoreWarning : null}
        <DatasetPositionView />
        {hasVolume && isVolumeSupported ? <VolumeActionsView /> : null}
        {isTraceMode ? <ViewModesView /> : null}
      </div>
    );
  }
}
const mapStateToProps = (state: OxalisState): Props => ({
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
  tracing: state.tracing,
  showVersionRestore: state.uiInformation.showVersionRestore,
});

export default connect(mapStateToProps)(ActionBarView);
