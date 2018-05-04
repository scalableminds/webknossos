// @flow

import * as React from "react";
import { connect } from "react-redux";
import Constants from "oxalis/constants";
import type { Rect, OrthoViewType } from "oxalis/constants";
import type { OxalisState } from "oxalis/store";

type StateProps = {
  scale: number,
  activeViewport: OrthoViewType,
};

type Props = StateProps & {
  viewportID: OrthoViewType | "arbitraryViewport",
  children?: React.Node,
};

function ignoreContextMenu(event: SyntheticInputEvent<>) {
  // hide contextmenu, while rightclicking a canvas
  event.preventDefault();
}

export function getInputCatcherRect(id: string): ?Rect {
  const inputCatcherDOM = document.getElementById(`inputcatcher_${id}`);
  if (!inputCatcherDOM) {
    return null;
  }
  const noneOverflowWrapper = inputCatcherDOM.closest(".gl-dont-overflow");
  if (!noneOverflowWrapper) {
    return null;
  }

  const { left, top, width, height } = inputCatcherDOM.getBoundingClientRect();
  const {
    width: wrapperWidth,
    height: wrapperHeight,
  } = noneOverflowWrapper.getBoundingClientRect();

  // Returns the viewport's coordinates and position
  // Width and height is cropped to the visible width/height of the scrollable container.
  // Otherwise, the we would render to parts of the canvas which are outside of the pane.
  return {
    left,
    top,
    width: Math.min(width, wrapperWidth),
    height: Math.min(height, wrapperHeight),
  };
}

class InputCatcher extends React.PureComponent<Props, {}> {
  render() {
    const width = Math.round(this.props.scale * Constants.VIEWPORT_WIDTH);
    const { viewportID } = this.props;
    const active = this.props.activeViewport === viewportID;

    return (
      <div className="gl-dont-overflow">
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
          {this.props.children}
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  scale: state.userConfiguration.scale,
  activeViewport: state.viewModeData.plane.activeViewport,
});

export default connect(mapStateToProps)(InputCatcher);
