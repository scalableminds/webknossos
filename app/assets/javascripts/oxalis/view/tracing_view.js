/**
 * tracing_view.js
 * @flow
 */

import { connect } from "react-redux";
import * as React from "react";
import classnames from "classnames";

import type { OxalisState } from "oxalis/store";
import { isVolumeTracingDisallowed } from "oxalis/model/accessors/volumetracing_accessor";
import Toast from "libs/toast";
import messages from "messages";

type Props = {
  isVolumeTracingDisallowed: boolean,
};

const registerWebGlCrashHandler = canvas => {
  if (!canvas) {
    return;
  }
  canvas.addEventListener(
    "webglcontextlost",
    e => {
      Toast.error(messages["webgl.context_loss"], { sticky: true });
      console.error("Webgl context lost", e);
    },
    false,
  );
};

class TracingView extends React.PureComponent<Props> {
  handleContextMenu(event: SyntheticInputEvent<>) {
    // hide contextmenu, while rightclicking a canvas
    event.preventDefault();
  }

  render() {
    const divClassName = classnames({
      "zoomstep-warning": this.props.isVolumeTracingDisallowed,
    });
    const canvasStyle = {
      width: "100%",
      position: "absolute",
      top: 0,
      left: 0,
    };

    return (
      <div className={divClassName} onContextMenu={this.handleContextMenu}>
        <canvas
          ref={registerWebGlCrashHandler}
          key="render-canvas"
          id="render-canvas"
          style={canvasStyle}
        />
      </div>
    );
  }
}
const mapStateToProps = (state: OxalisState): Props => ({
  isVolumeTracingDisallowed: state.tracing.volume != null && isVolumeTracingDisallowed(state),
});

export default connect(mapStateToProps)(TracingView);
