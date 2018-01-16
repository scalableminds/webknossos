// @flow
import * as React from "react";
import { connect } from "react-redux";
import TracingActionsView from "oxalis/view/action-bar/tracing_actions_view";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import Constants, { ControlModeEnum } from "oxalis/constants";
import type { ModeType, ControlModeType } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";

type Props = {
  viewMode: ModeType,
  controlMode: ControlModeType,
};

// eslint-disable-next-line react/prefer-stateless-function
class ActionBarView extends React.PureComponent<Props> {
  render() {
    const isTraceMode = this.props.controlMode === ControlModeEnum.TRACE;
    const isVolumeMode = this.props.viewMode === Constants.MODE_VOLUME;

    return (
      <div className="action-bar">
        {isTraceMode ? <TracingActionsView /> : null}
        <DatasetPositionView />
        {isVolumeMode ? <VolumeActionsView /> : null}
        {!isVolumeMode && isTraceMode ? <ViewModesView /> : null}
      </div>
    );
  }
}
const mapStateToProps = (state: OxalisState): Props => ({
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
  restrictions: state.tracing.restrictions,
});

export default connect(mapStateToProps)(ActionBarView);
