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
import type { OxalisState } from "oxalis/store";
import type { Dispatch } from "redux";

const ButtonGroup = Button.Group;

class TracingView extends React.PureComponent {

  handleContextMenu(event: SyntheticInputEvent) {
    // hide contextmenu, while rightclicking a canvas
    event.preventDefault();
  }

  getInputCatchers() {
    return (
      <div id="inputcatchers">
        <div id="inputcatcher_PLANE_XY" className="inputcatcher" />
        <div id="inputcatcher_PLANE_YZ" className="inputcatcher" />
        <div id="inputcatcher_PLANE_XZ" className="inputcatcher" />
        <div id="inputcatcher_TDView" className="inputcatcher">
          <ButtonGroup id="TDViewControls">
            <Button size="small">3D</Button>
            <Button size="small">
              <span />XY
            </Button>
            <Button size="small">
              <span />YZ
            </Button>
            <Button size="small">
              <span />XZ
            </Button>
          </ButtonGroup>
        </div>
      </div>
    );
  }

  getRecordingSwitch = () =>
    <Switch
      checkedChildren="Recording"
      unCheckedChildren="Watching"
      checked={this.props.flightmodeRecording}
      onChange={this.props.onChangeFlightmodeRecording}
    />

  render() {
    const isArbitraryMode = Constants.MODES_ARBITRARY.includes(this.props.viewMode);
    const inputCatchers = !isArbitraryMode ? this.getInputCatchers() : null;
    const flightModeRecordingSwitch = isArbitraryMode ? this.getRecordingSwitch : null;

    // canvas will be
    return (
      <div id="render" onContextMenu={this.handleContextMenu}>
        { inputCatchers }
        { flightModeRecordingSwitch }
        <canvas id="render-canvas" />
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
});

export default connect(mapStateToProps, mapDispatchToProps)(TracingView);
