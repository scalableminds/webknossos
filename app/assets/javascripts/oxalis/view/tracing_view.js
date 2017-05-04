/**
 * tracing_view.js
 * @flow
 */

import React from "react";
import { connect } from "react-redux";
import { Button, Switch } from "antd";
import Constants from "oxalis/constants";
import app from "app";
import { setFlightmodeRecordingAction } from "oxalis/model/actions/settings_actions";
import InputCatchers from "oxalis/view/input_catchers";
import type { OxalisState } from "oxalis/store";
import type { Dispatch } from "redux";

class TracingView extends React.PureComponent {

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

    const canvasWidth = Math.round(this.props.scale * Constants.VIEWPORT_WIDTH) * 2 + 20;
    const canvasStyle = {
      width: canvasWidth,
      height: canvasWidth,
    };

    return (
      <div id="tracing" onContextMenu={this.handleContextMenu}>
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
});

export default connect(mapStateToProps, mapDispatchToProps)(TracingView);
