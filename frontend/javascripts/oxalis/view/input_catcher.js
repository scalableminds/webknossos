// @flow

import * as React from "react";

import { ArbitraryViewport, type Rect, type Viewport } from "oxalis/constants";
import { setInputCatcherRects } from "oxalis/model/actions/view_mode_actions";
import Scalebar from "oxalis/view/scalebar";
import ViewportStatusIndicator from "oxalis/view/viewport_status_indicator";
import Store from "oxalis/store";
import makeRectRelativeToCanvas from "oxalis/view/layouting/layout_canvas_adapter";
import { defaultViewportRect } from "oxalis/default_state";

type Props = {
  viewportID: Viewport,
  children?: React.Node,
  displayScalebars?: boolean,
};

function ignoreContextMenu(event: SyntheticInputEvent<>) {
  // hide contextmenu, while rightclicking a canvas
  event.preventDefault();
}

// Is able to make the input catcher a square (if makeQuadratic is true)
// and returns its position within the document relative to the rendering canvas
function adaptInputCatcher(inputCatcherDOM: HTMLElement, makeQuadratic: boolean): Rect {
  const noneOverflowWrapper = inputCatcherDOM.closest(".flexlayout-dont-overflow");
  if (!noneOverflowWrapper) {
    return { top: 0, left: 0, width: 0, height: 0 };
  }
  // If the inputcatcher does not need to be quadratic, the extent is handled by css automatically.
  if (makeQuadratic) {
    const getQuadraticExtent = () => {
      let { width, height } = noneOverflowWrapper.getBoundingClientRect();
      // These values should be floored, so that the rendered area does not overlap
      // with the containers.
      width = Math.floor(width);
      height = Math.floor(height);
      const extent = Math.min(width, height);
      return [extent, extent];
    };
    const [width, height] = getQuadraticExtent();
    inputCatcherDOM.style.width = `${width}px`;
    inputCatcherDOM.style.height = `${height}px`;
  }
  return makeRectRelativeToCanvas(inputCatcherDOM.getBoundingClientRect());
}

const renderedInputCatchers = new Map();

export function recalculateInputCatcherSizes() {
  const viewportRects: Object = {
    PLANE_XY: defaultViewportRect,
    PLANE_YZ: defaultViewportRect,
    PLANE_XZ: defaultViewportRect,
    TDView: defaultViewportRect,
  };

  for (const [viewportID, inputCatcher] of renderedInputCatchers.entries()) {
    const makeQuadratic = viewportID === ArbitraryViewport;
    const rect = adaptInputCatcher(inputCatcher, makeQuadratic);
    viewportRects[viewportID] = rect;
  }
  Store.dispatch(setInputCatcherRects(viewportRects));
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
      <div className="flexlayout-dont-overflow">
        <div
          id={`inputcatcher_${viewportID}`}
          ref={domElement => {
            this.domElement = domElement;
          }}
          onContextMenu={ignoreContextMenu}
          data-value={viewportID}
          className={`inputcatcher ${viewportID}`}
          style={{ position: "relative" }}
        >
          <ViewportStatusIndicator />
          {this.props.displayScalebars && viewportID !== "arbitraryViewport" ? (
            <Scalebar viewportID={viewportID} />
          ) : null}
          {this.props.children}
        </div>
      </div>
    );
  }
}

export default InputCatcher;
