// @flow

import * as React from "react";

import { ArbitraryViewport, type Rect, type Viewport } from "oxalis/constants";
import { setInputCatcherRects } from "oxalis/model/actions/view_mode_actions";
import Scalebar from "oxalis/view/scalebar";
import ViewportStatusIndicator from "oxalis/view/viewport_status_indicator";
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

// Is able to make the input catcher a square (if makeQuadratic is true)
// and returns its position within the document relative to the rendering canvas
function adaptInputCatcher(inputCatcherDOM: HTMLElement, makeQuadratic: boolean): Rect {
  const noneOverflowWrapper = inputCatcherDOM.closest(".flexlayout-dont-overflow");
  if (!noneOverflowWrapper) {
    return { top: 0, left: 0, width: 0, height: 0 };
  }

  // TODO Maybe get rid of this width and height calculation and just use css props (if makeQuadratic) is not set

  /* const getExtent = () => {
    let { width, height } = noneOverflowWrapper.getBoundingClientRect();
    // These values should be floored, so that the rendered area does not overlap
    // with the golden layout containers
    width = Math.floor(width);
    height = Math.floor(height);

    if (makeQuadratic) {
      const extent = Math.min(width, height);
      return [extent, extent];
    } else {
      return [width, height];
    }
  };
  const [width, height] = getExtent();
  inputCatcherDOM.style.width = `${width}px`;
  inputCatcherDOM.style.height = `${height}px`; */

  return makeRectRelativeToCanvas(inputCatcherDOM.getBoundingClientRect());
}

const renderedInputCatchers = new Map();

export function recalculateInputCatcherSizes() {
  const viewportRects = {};
  for (const [viewportID, inputCatcher] of renderedInputCatchers.entries()) {
    const rect = adaptInputCatcher(inputCatcher, viewportID === ArbitraryViewport);
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
