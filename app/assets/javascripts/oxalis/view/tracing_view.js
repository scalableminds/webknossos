/**
 * tracing_view.js
 * @flow
 */

import * as React from "react";
import classnames from "classnames";
import { connect } from "react-redux";
import { Switch } from "antd";
import Constants from "oxalis/constants";
import { setFlightmodeRecordingAction } from "oxalis/model/actions/settings_actions";
import InputCatchers from "oxalis/view/input_catchers";
import { isVolumeTracingDisallowed } from "oxalis/model/accessors/volumetracing_accessor";
import type { OxalisState, PlaneLayoutType } from "oxalis/store";
import type { ModeType } from "oxalis/constants";
import type { Dispatch } from "redux";
import { getCanvasExtent } from "./viewport_calculations";

type Props = {
  flightmodeRecording: boolean,
  onChangeFlightmodeRecording: ?Function,
  viewMode: ModeType,
  scale: number,
  isVolumeTracingDisallowed: boolean,
  activePlaneLayout: PlaneLayoutType,
};

class TracingView extends React.PureComponent<Props> {
  handleContextMenu(event: SyntheticInputEvent<>) {
    // hide contextmenu, while rightclicking a canvas
    event.preventDefault();
  }

  getRecordingSwitch = () => (
    <Switch
      id="flightmode-switch"
      checkedChildren="Recording"
      unCheckedChildren="Watching"
      checked={this.props.flightmodeRecording}
      onChange={this.props.onChangeFlightmodeRecording}
    />
  );

  render() {
    const isArbitraryMode = Constants.MODES_ARBITRARY.includes(this.props.viewMode);
    const scaledViewportWidth = Math.round(this.props.scale * Constants.VIEWPORT_WIDTH);
    const [width, height] = isArbitraryMode
      ? [scaledViewportWidth, scaledViewportWidth]
      : getCanvasExtent(this.props.activePlaneLayout, scaledViewportWidth);
    const flightModeRecordingSwitch = isArbitraryMode ? this.getRecordingSwitch() : null;
    const divClassName = classnames({ "zoomstep-warning": this.props.isVolumeTracingDisallowed });

    const canvasStyle = {
      width: "100%",
      position: "absolute",
      top: 0,
      left: 0,
    };

    return this.props.renderCanvas ? (
      <div
        style={{ position: "relative" }}
        className={divClassName}
        onContextMenu={this.handleContextMenu}
      >
        <canvas key="render-canvas" id="render-canvas" style={canvasStyle} />
      </div>
    ) : (
      <div>{flightModeRecordingSwitch}</div>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onChangeFlightmodeRecording(value) {
    dispatch(setFlightmodeRecordingAction(value));
  },
});

const mapStateToProps = (state: OxalisState) => ({
  viewMode: state.temporaryConfiguration.viewMode,
  flightmodeRecording: state.temporaryConfiguration.flightmodeRecording,
  scale: state.userConfiguration.scale,
  isVolumeTracingDisallowed: state.tracing.type === "volume" && isVolumeTracingDisallowed(state),
  activePlaneLayout: state.viewModeData.plane.activeLayout,
});

export default connect(mapStateToProps, mapDispatchToProps)(TracingView);
