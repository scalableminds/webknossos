import { Switch } from "antd";
import { connect } from "react-redux";
import * as React from "react";
import type { Dispatch } from "redux";
import type { OxalisState } from "oxalis/store";
import { setFlightmodeRecordingAction } from "oxalis/model/actions/settings_actions";
type Props = {
  flightmodeRecording: boolean;
  onChangeFlightmodeRecording: (arg0: boolean) => void;
};

function RecordingSwitch({ flightmodeRecording, onChangeFlightmodeRecording }: Props) {
  return (
    <Switch
      // @ts-expect-error ts-migrate(2322) FIXME: Type '{ id: string; checkedChildren: string; unChe... Remove this comment to see the full error message
      id="flightmode-switch"
      checkedChildren="Recording"
      unCheckedChildren="Watching"
      checked={flightmodeRecording}
      onChange={onChangeFlightmodeRecording}
    />
  );
}

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'value' implicitly has an 'any' type.
  onChangeFlightmodeRecording(value) {
    dispatch(setFlightmodeRecordingAction(value));
  },
});

const mapStateToProps = (state: OxalisState) => ({
  flightmodeRecording: state.temporaryConfiguration.flightmodeRecording,
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(RecordingSwitch);
