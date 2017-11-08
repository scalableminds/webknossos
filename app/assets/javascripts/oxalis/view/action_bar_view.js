// @flow
import * as React from "react";
import { connect } from "react-redux";
import TracingActionsView from "oxalis/view/action-bar/tracing_actions_view";
import DatasetPositionView from "oxalis/view/action-bar/dataset_position_view";
import ViewModesView from "oxalis/view/action-bar/view_modes_view";
import VolumeActionsView from "oxalis/view/action-bar/volume_actions_view";
import Constants, { ControlModeEnum } from "oxalis/constants";
import type { ModeType, ControlModeType } from "oxalis/constants";
import type { OxalisState, RestrictionsType, SettingsType } from "oxalis/store";

type Props = {
  viewMode: ModeType,
  controlMode: ControlModeType,
  restrictions: RestrictionsType & SettingsType,
};

// eslint-disable-next-line react/prefer-stateless-function
class ActionBarView extends React.PureComponent<Props> {
  render() {
    const isTraceMode = this.props.controlMode === ControlModeEnum.TRACE;
    const isVolumeMode = this.props.viewMode === Constants.MODE_VOLUME;
    const hasAdvancedOptions = this.props.restrictions.advancedOptionsAllowed;

    return (
      <div className="action-bar">
        {isTraceMode ? <TracingActionsView /> : null}
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
