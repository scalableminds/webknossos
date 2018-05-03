// @flow

import * as React from "react";
import { connect } from "react-redux";
import { Button } from "antd";
import Constants, { OrthoViews } from "oxalis/constants";
import api from "oxalis/api/internal_api";
import type { OrthoViewType } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";

const ButtonGroup = Button.Group;

type Props = {
  scale: number,
  activeViewport: OrthoViewType,
};

type State = {};

class InputCatchers extends React.PureComponent<Props, State> {
  render() {
    const width = Math.round(this.props.scale * Constants.VIEWPORT_WIDTH);
    const TDButtonStyle = {
      width: width / 4 - 0.5,
    };

    const activeInputCatcher = this.props.activeViewport;

    return (
      <div id="inputcatchers" style={{ cursor: false ? "none" : "" }}>
        <div
          id="inputcatcher_PLANE_XY"
          data-value={OrthoViews.PLANE_XY}
          className="inputcatcher"
          style={{
            width,
            height: width,
            borderColor: activeInputCatcher === OrthoViews.PLANE_XY ? "#ff0" : "white",
          }}
        />
        <div
          id="inputcatcher_PLANE_YZ"
          data-value={OrthoViews.PLANE_YZ}
          className="inputcatcher"
          style={{
            width,
            height: width,
            borderColor: activeInputCatcher === OrthoViews.PLANE_YZ ? "#ff0" : "white",
          }}
        />
        <div
          id="inputcatcher_PLANE_XZ"
          data-value={OrthoViews.PLANE_XZ}
          className="inputcatcher"
          style={{
            width,
            height: width,
            borderColor: activeInputCatcher === OrthoViews.PLANE_XZ ? "#ff0" : "white",
          }}
        />
        <div
          id="inputcatcher_TDView"
          data-value={OrthoViews.TDView}
          className="inputcatcher"
          style={{
            width,
            height: width,
            borderColor: activeInputCatcher === OrthoViews.TDView ? "#ff0" : "white",
          }}
        >
          <ButtonGroup id="TDViewControls">
            <Button size="small" style={TDButtonStyle} onClick={api.tracing.rotate3DViewToDiagonal}>
              3D
            </Button>
            <Button size="small" style={TDButtonStyle} onClick={api.tracing.rotate3DViewToXY}>
              <span className="colored-dot" />XY
            </Button>
            <Button size="small" style={TDButtonStyle} onClick={api.tracing.rotate3DViewToYZ}>
              <span className="colored-dot" />YZ
            </Button>
            <Button size="small" style={TDButtonStyle} onClick={api.tracing.rotate3DViewToXZ}>
              <span className="colored-dot" />XZ
            </Button>
          </ButtonGroup>
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): Props => ({
  scale: state.userConfiguration.scale,
  activeViewport: state.viewModeData.plane.activeViewport,
});

export default connect(mapStateToProps)(InputCatchers);
