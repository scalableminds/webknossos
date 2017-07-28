// @flow

import React from "react";
import { connect } from "react-redux";
import { Button } from "antd";
import Constants, { OrthoViews } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";
import api from "oxalis/api/internal_api";

const ButtonGroup = Button.Group;

class InputCatchers extends React.PureComponent {
  state = {
    activeInputCatcher: "",
  };

  handleMouseOver = (event: SyntheticInputEvent) => {
    this.setState({
      activeInputCatcher: event.target.dataset.value,
    });
  };

  render() {
    const width = Math.round(this.props.scale * Constants.VIEWPORT_WIDTH);
    const TDButtonStyle = {
      width: width / 4 - 0.5,
    };

    const activeInputCatcher = this.state.activeInputCatcher;

    return (
      <div id="inputcatchers">
        <div
          id="inputcatcher_PLANE_XY"
          data-value={OrthoViews.PLANE_XY}
          className="inputcatcher"
          onMouseOver={this.handleMouseOver}
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
          onMouseOver={this.handleMouseOver}
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
          onMouseOver={this.handleMouseOver}
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
          onMouseOver={this.handleMouseOver}
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

const mapStateToProps = (state: OxalisState) => ({
  scale: state.userConfiguration.scale,
});

export default connect(mapStateToProps)(InputCatchers);
