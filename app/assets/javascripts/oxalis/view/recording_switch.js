// @flow
import { connect } from "react-redux";
import * as React from "react";
import { Switch } from "antd";
import type { OxalisState } from "oxalis/store";
import { setFlightmodeRecordingAction } from "oxalis/model/actions/settings_actions";

type Props = {
  flightmodeRecording: boolean,
  onChangeFlightmodeRecording: ?Function,
};

function RecordingSwitch({ flightmodeRecording, onChangeFlightmodeRecording }: Props) {
  return (
    <Switch
      id="flightmode-switch"
      checkedChildren="Recording"
      unCheckedChildren="Watching"
      checked={flightmodeRecording}
      onChange={onChangeFlightmodeRecording}
    />
  );
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeFlightmodeRecording(value) {
    dispatch(setFlightmodeRecordingAction(value));
  },
});

const mapStateToProps = (state: OxalisState) => ({
  flightmodeRecording: state.temporaryConfiguration.flightmodeRecording,
});

export default connect(mapStateToProps, mapDispatchToProps)(RecordingSwitch);
