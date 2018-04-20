// @flow

import * as React from "react";
import { connect } from "react-redux";
import { Button } from "antd";
import Constants, { OrthoViews } from "oxalis/constants";
import api from "oxalis/api/internal_api";
import type { Vector2, OrthoViewType } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";

const ButtonGroup = Button.Group;

type Props = {
  scale: number,
  activeViewport: OrthoViewType,
  brushPosition: ?Vector2,
  brushSize: number,
  width: number,
  height: number,
};

type State = {};

function TDViewControls({ width }) {
  const TDButtonStyle = { width: width / 4 - 0.5 };
  return (
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
  );
}

class InputCatchers extends React.PureComponent<Props, State> {
  handleContextMenu(event: SyntheticInputEvent<>) {
    // hide contextmenu, while rightclicking a canvas
    event.preventDefault();
  }

  render() {
    const width = Math.round(this.props.scale * Constants.VIEWPORT_WIDTH);

    const { brushPosition, brushSize } = this.props;
    const brush =
      brushPosition != null ? (
        <div
          id="cursor"
          style={{
            position: "relative",
            left: brushPosition[0] - brushSize / 2,
            top: brushPosition[1] - brushSize / 2,
            width: brushSize,
            height: brushSize,
            borderColor: "black",
            borderStyle: "solid",
            borderWidth: 1,
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />
      ) : null;

    const activeInputCatcher = this.props.activeViewport;

    const InputCatcher = ({ name, planeType, children }) => {
      const active = activeInputCatcher === planeType;
      console.log("children", children);
      return (
        <div
          id={`inputcatcher_${name}`}
          onContextMenu={this.handleContextMenu}
          data-value={planeType}
          className="inputcatcher"
          style={{
            width,
            height: width,
            borderColor: active ? "#ff0" : "white",
          }}
        >
          {children || (active ? brush : null)}
        </div>
      );
    };

    switch (this.props.planeID) {
      case "xy":
        return <InputCatcher name="PLANE_XY" planeType={OrthoViews.PLANE_XY} />;
      case "yz":
        return <InputCatcher name="PLANE_YZ" planeType={OrthoViews.PLANE_YZ} />;
      case "xz":
        return <InputCatcher name="PLANE_XZ" planeType={OrthoViews.PLANE_XZ} />;
      case "td":
        return (
          <InputCatcher name="TDView" planeType={OrthoViews.TDView}>
            <TDViewControls width={width} />
          </InputCatcher>
        );
    }
  }
}

const mapStateToProps = (state: OxalisState): Props => ({
  scale: state.userConfiguration.scale,
  activeViewport: state.viewModeData.plane.activeViewport,
  brushPosition: state.temporaryConfiguration.brushPosition,
  brushSize: state.temporaryConfiguration.brushSize,
});

export default connect(mapStateToProps)(InputCatchers);
