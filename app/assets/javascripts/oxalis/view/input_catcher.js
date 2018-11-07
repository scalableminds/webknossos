// @flow

import * as React from "react";

import type { Rect, Viewport } from "oxalis/constants";
import { setInputCatcherRect } from "oxalis/model/actions/view_mode_actions";
import Scalebar from "oxalis/view/scalebar";
import Store from "oxalis/store";
import makeRectRelativeToCanvas from "oxalis/view/layouting/layout_canvas_adapter";

type Props = {
  viewportID: Viewport,
  children?: React.Node,
  displayScalebars?: boolean,
};

function ignoreContextMenu(event: SyntheticInputEvent<>) {
  // hide contextmenu, while rightclicking a canvas
  event.preventDefault();
}

// makes the input catcher a square and returns its position within the document
// relative to the rendering canvas
function makeInputCatcherQuadratic(inputCatcherDOM: HTMLElement): Rect {
  const noneOverflowWrapper = inputCatcherDOM.closest(".gl-dont-overflow");
  if (!noneOverflowWrapper) {
    return { top: 0, left: 0, width: 0, height: 0 };
  }

  const {
    width: wrapperWidth,
    height: wrapperHeight,
  } = noneOverflowWrapper.getBoundingClientRect();

  const squareExtent = Math.round(Math.min(wrapperWidth, wrapperHeight));
  inputCatcherDOM.style.width = `${squareExtent}px`;
  inputCatcherDOM.style.height = `${squareExtent}px`;

  return makeRectRelativeToCanvas(inputCatcherDOM.getBoundingClientRect());
}

const renderedInputCatchers = new Map();

export function recalculateInputCatcherSizes() {
  for (const [viewportID, inputCatcher] of renderedInputCatchers.entries()) {
    const rect = makeInputCatcherQuadratic(inputCatcher);
    Store.dispatch(setInputCatcherRect(viewportID, rect));
  }
}

class InputCatcher extends React.PureComponent<Props, {}> {
  domElement: ?HTMLElement;

  componentDidMount() {
    if (this.domElement) {
      renderedInputCatchers.set(this.props.viewportID, this.domElement);
    }
  }

  componentWillUnmount() {
    if (this.domElement) {
      renderedInputCatchers.delete(this.props.viewportID);
    }
  }

  render() {
    const { viewportID } = this.props;

    return (
      <div className="gl-dont-overflow">
        <div
          id={`inputcatcher_${viewportID}`}
          ref={domElement => {
            this.domElement = domElement;
          }}
          onContextMenu={ignoreContextMenu}
          data-value={viewportID}
          className="inputcatcher"
          style={{ position: "relative" }}
        >
          {this.props.displayScalebars ? <Scalebar /> : null}
          {this.props.children}
        </div>
      </div>
    );
  }
}

export default InputCatcher;
