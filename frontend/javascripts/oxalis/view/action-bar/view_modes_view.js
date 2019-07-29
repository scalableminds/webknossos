// @flow
import { Select } from "antd";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import React, { PureComponent } from "react";

import {
  setViewModeAction,
  setFlightmodeRecordingAction,
} from "oxalis/model/actions/settings_actions";

import Store, { type OxalisState, type AllowedMode } from "oxalis/store";
import * as Utils from "libs/utils";
import constants, { type ViewMode } from "oxalis/constants";

const { Option } = Select;

type StateProps = {|
  viewMode: ViewMode,
  allowedModes: Array<AllowedMode>,
|};

type DispatchProps = {|
  onChangeFlightmodeRecording: boolean => void,
|};

type Props = {| ...StateProps, ...DispatchProps |};

class ViewModesView extends PureComponent<Props, {}> {
  blurElement = (event: SyntheticInputEvent<>) => {
    event.target.blur();
  };

  handleChange = (mode: ViewMode) => {
    // If we switch back from any arbitrary mode we stop recording.
    // This prevents that when the user switches back to any flightmode,
    // a new node is instantly created at the screens center.
    if (
      constants.MODES_ARBITRARY.includes(this.props.viewMode) &&
      mode === constants.MODE_PLANE_TRACING
    ) {
      this.props.onChangeFlightmodeRecording(false);
    }
    Store.dispatch(setViewModeAction(mode));

    // Unfortunately, antd doesn't provide the original event here
    // which is why we have to blur using document.activElement.
    // Additionally, we need a timeout since the blurring would be done
    // to early, otherwise.
    setTimeout(() => {
      if (document.activeElement != null) {
        document.activeElement.blur();
      }
    }, 100);
  };

  isDisabled(mode: ViewMode) {
    return !this.props.allowedModes.includes(mode);
  }

  render() {
    return (
      <Select value={this.props.viewMode} style={{ width: 120 }} onChange={this.handleChange}>
        {[
          constants.MODE_PLANE_TRACING,
          constants.MODE_ARBITRARY,
          constants.MODE_ARBITRARY_PLANE,
        ].map(mode => (
          <Option key={mode} disabled={this.isDisabled(mode)} value={mode}>
            {Utils.capitalize(mode)}
          </Option>
        ))}
      </Select>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeFlightmodeRecording(value: boolean) {
    dispatch(setFlightmodeRecordingAction(value));
  },
});

function mapStateToProps(state: OxalisState): StateProps {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
    allowedModes: state.tracing.restrictions.allowedModes,
  };
}

export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(ViewModesView);
