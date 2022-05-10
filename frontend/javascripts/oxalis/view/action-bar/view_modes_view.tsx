import { Select } from "antd";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import React, { PureComponent } from "react";
import {
  setViewModeAction,
  setFlightmodeRecordingAction,
} from "oxalis/model/actions/settings_actions";
import type { OxalisState, AllowedMode } from "oxalis/store";
import Store from "oxalis/store";
import * as Utils from "libs/utils";
import type { ViewMode } from "oxalis/constants";
import constants from "oxalis/constants";
const { Option } = Select;
type StateProps = {
  viewMode: ViewMode;
  allowedModes: Array<AllowedMode>;
};
type DispatchProps = {
  onChangeFlightmodeRecording: (arg0: boolean) => void;
};
type Props = StateProps & DispatchProps;

class ViewModesView extends PureComponent<Props, {}> {
  handleChange = (mode: ViewMode) => {
    // If we switch back from any arbitrary mode we stop recording.
    // This prevents that when the user switches back to any arbitrary mode,
    // a new node is instantly created at the screen's center.
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'blur' does not exist on type 'Element'.
        document.activeElement.blur();
      }
    }, 100);
  };

  isDisabled(mode: ViewMode) {
    return !this.props.allowedModes.includes(mode);
  }

  render() {
    return (
      <Select
        value={this.props.viewMode}
        style={{
          width: 120,
        }}
        onChange={this.handleChange}
      >
        {[
          constants.MODE_PLANE_TRACING,
          constants.MODE_ARBITRARY,
          constants.MODE_ARBITRARY_PLANE,
        ].map((mode) => (
          <Option key={mode} disabled={this.isDisabled(mode)} value={mode}>
            {Utils.capitalize(mode)}
          </Option>
        ))}
      </Select>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
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

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(ViewModesView);
