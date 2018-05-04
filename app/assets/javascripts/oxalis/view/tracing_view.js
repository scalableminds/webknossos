/**
 * tracing_view.js
 * @flow
 */

import * as React from "react";
import classnames from "classnames";
import { connect } from "react-redux";
import { isVolumeTracingDisallowed } from "oxalis/model/accessors/volumetracing_accessor";
import type { OxalisState } from "oxalis/store";

type Props = {
  isVolumeTracingDisallowed: boolean,
};

class TracingView extends React.PureComponent<Props> {
  handleContextMenu(event: SyntheticInputEvent<>) {
    // hide contextmenu, while rightclicking a canvas
    event.preventDefault();
  }

  render() {
    const divClassName = classnames({ "zoomstep-warning": this.props.isVolumeTracingDisallowed });
    const canvasStyle = {
      width: "100%",
      position: "absolute",
      top: 0,
      left: 0,
    };

    return (
      <div
        style={{ position: "relative" }}
        className={divClassName}
        onContextMenu={this.handleContextMenu}
      >
        <canvas key="render-canvas" id="render-canvas" style={canvasStyle} />
      </div>
    );
  }
}
const mapStateToProps = (state: OxalisState): Props => ({
  isVolumeTracingDisallowed: state.tracing.type === "volume" && isVolumeTracingDisallowed(state),
});

export default connect(mapStateToProps)(TracingView);
