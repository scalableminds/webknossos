import { Switch } from "antd";
import { setFlightmodeRecordingAction } from "oxalis/model/actions/settings_actions";
import type { OxalisState } from "oxalis/store";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
type Props = {
  flightmodeRecording: boolean;
  onChangeFlightmodeRecording: (arg0: boolean) => void;
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
