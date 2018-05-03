// @flow

import * as React from "react";
import { connect } from "react-redux";
import { Button } from "antd";
import Constants, { OrthoViews } from "oxalis/constants";
import api from "oxalis/api/internal_api";
import type { OrthoViewType } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";

const ButtonGroup = Button.Group;

type StateProps = {
  scale: number,
  activeViewport: OrthoViewType,
};

type Props = StateProps & {
  viewportID: OrthoViewType | "arbitraryViewport",
};

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

function ignoreContextMenu(event: SyntheticInputEvent<>) {
  // hide contextmenu, while rightclicking a canvas
  event.preventDefault();
}

class InputCatcher extends React.PureComponent<Props, {}> {
  render() {
    const width = Math.round(this.props.scale * Constants.VIEWPORT_WIDTH);
    const child =
      this.props.viewportID === OrthoViews.TDView ? <TDViewControls width={width} /> : null;

    const { viewportID } = this.props;
    const active = this.props.activeViewport === viewportID;

    return (
      <div
        id={`inputcatcher_${viewportID}`}
        onContextMenu={ignoreContextMenu}
        data-value={viewportID}
        className="inputcatcher"
        style={{
          width,
          height: width,
          borderColor: active ? "#ff0" : "white",
        }}
      >
        {child}
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  scale: state.userConfiguration.scale,
  activeViewport: state.viewModeData.plane.activeViewport,
});

export default connect(mapStateToProps)(InputCatcher);
