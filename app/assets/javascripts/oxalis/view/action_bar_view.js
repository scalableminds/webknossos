// @flow
import * as React from "react";
import { connect } from "react-redux";
import TracingActionsView from "oxalis/view/action-bar/tracing_actions_view";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import Constants, { ControlModeEnum } from "oxalis/constants";
import type { ModeType, ControlModeType } from "oxalis/constants";
import type { OxalisState, TracingType } from "oxalis/store";

type Props = {
  viewMode: ModeType,
  controlMode: ControlModeType,
  tracing: TracingType,
};

// eslint-disable-next-line react/prefer-stateless-function
class ActionBarView extends React.PureComponent<Props> {
  render() {
    const isTraceMode = this.props.controlMode === ControlModeEnum.TRACE;
    const hasVolume = this.props.tracing.volume != null;
    const isVolumeSupported = !Constants.MODES_ARBITRARY.includes(this.props.viewMode);

    return (
      <div className="action-bar">
        {isTraceMode ? <TracingActionsView /> : null}
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
});

export default connect(mapStateToProps)(ActionBarView);
