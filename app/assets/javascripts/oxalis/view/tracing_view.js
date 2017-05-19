/**
 * tracing_view.js
 * @flow
 */

import React from "react";
import classnames from "classnames";
import { connect } from "react-redux";
import { Switch } from "antd";
import Constants from "oxalis/constants";
import app from "app";
import { setFlightmodeRecordingAction } from "oxalis/model/actions/settings_actions";
import InputCatchers from "oxalis/view/input_catchers";
import { isVolumeTracingDisallowed } from "oxalis/model/accessors/volumetracing_accessor";
import type { OxalisState } from "oxalis/store";
import type { ModeType } from "oxalis/constants";
import type { Dispatch } from "redux";

class TracingView extends React.PureComponent {
  props: {
    flightmodeRecording: boolean,
    onChangeFlightmodeRecording: (boolean) => {},
    viewMode: ModeType,
    scale: number,
    isVolumeTracingDisallowed: boolean,
  }

  handleContextMenu(event: SyntheticInputEvent) {
    // hide contextmenu, while rightclicking a canvas
    event.preventDefault();
  }

  getRecordingSwitch = () =>
    <Switch
      id="flightmode-switch"
      checkedChildren="Recording"
      unCheckedChildren="Watching"
      checked={this.props.flightmodeRecording}
      onChange={this.props.onChangeFlightmodeRecording}
    />

  render() {
    const isArbitraryMode = Constants.MODES_ARBITRARY.includes(this.props.viewMode);
    const inputCatchers = !isArbitraryMode ? <InputCatchers /> : null;
    const flightModeRecordingSwitch = isArbitraryMode ? this.getRecordingSwitch() : null;
    const divClassName = classnames({ "zoomstep-warning": this.props.isVolumeTracingDisallowed });

    const canvasWidth = Math.round(this.props.scale * Constants.VIEWPORT_WIDTH) * 2 + 20;
    const canvasStyle = {
      width: canvasWidth,
      height: canvasWidth,
    };

    return (
      <div id="tracing" className={divClassName} onContextMenu={this.handleContextMenu}>
        { inputCatchers }
        { flightModeRecordingSwitch }
        <canvas id="render-canvas" style={canvasStyle} />
      </div>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeFlightmodeRecording(value) {
    dispatch(setFlightmodeRecordingAction(value));
    if (app.oxalis) {
      app.oxalis.arbitraryController.setWaypoint();
    }
  },
});

const mapStateToProps = (state: OxalisState) => ({
  viewMode: state.temporaryConfiguration.viewMode,
  flightmodeRecording: state.temporaryConfiguration.flightmodeRecording,
  scale: state.userConfiguration.scale,
  isVolumeTracingDisallowed: isVolumeTracingDisallowed(state),
});

export default connect(mapStateToProps, mapDispatchToProps)(TracingView);
