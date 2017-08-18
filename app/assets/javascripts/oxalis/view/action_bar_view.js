// @flow
import * as React from "react";
import { connect } from "react-redux";
import DatasetActionsView from "oxalis/view/action-bar/dataset_actions_view";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import Constants, { ControlModeEnum } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";

// eslint-disable-next-line react/prefer-stateless-function
class ActionBarView extends React.PureComponent<$FlowFixMeProps> {
  render() {
    const isTraceMode = this.props.controlMode === ControlModeEnum.TRACE;
    const isVolumeMode = this.props.viewMode === Constants.MODE_VOLUME;
    const hasAdvancedOptions = this.props.restrictions.advancedOptionsAllowed;

    return (
      <div className="action-bar">
        {isTraceMode ? <DatasetActionsView /> : null}
        {hasAdvancedOptions ? <DatasetPositionView /> : null}
        {isVolumeMode && hasAdvancedOptions ? <VolumeActionsView /> : null}
        {!isVolumeMode && isTraceMode && hasAdvancedOptions ? <ViewModesView /> : null}
      </div>
    );
  }
}
const mapStateToProps = (state: OxalisState) => ({
  viewMode: state.temporaryConfiguration.viewMode,
  controlMode: state.temporaryConfiguration.controlMode,
  restrictions: state.tracing.restrictions,
});

export default connect(mapStateToProps)(ActionBarView);
