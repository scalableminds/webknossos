// @flow
import { connect } from "react-redux";
import * as React from "react";
import type { OxalisState } from "oxalis/store";
import api from "oxalis/api/internal_api";
import { Button } from "antd";
import Constants from "oxalis/constants";

const ButtonGroup = Button.Group;

type Props = { width: number };

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

const mapStateToProps = (state: OxalisState): Props => ({
  width: Math.round(state.userConfiguration.scale * Constants.VIEWPORT_WIDTH),
});

export default connect(mapStateToProps)(TDViewControls);
