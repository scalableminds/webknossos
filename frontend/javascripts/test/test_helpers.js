// @flow

import { setInputCatcherRects } from "oxalis/model/actions/view_mode_actions";
import Constants, { allViewports } from "oxalis/constants";
import Store from "oxalis/store";

// For some tests viewports with a none 0 extent is needed to calculate a correct zoom level.
export default function setViewportRectsToNoneZeroExtent() {
  const viewportRects = {};
  allViewports.forEach(viewportID => {
    viewportRects[viewportID] = {
      top: 0,
      left: 0,
      width: Constants.VIEWPORT_WIDTH,
      height: Constants.VIEWPORT_WIDTH,
    };
  });
  Store.dispatch(setInputCatcherRects(viewportRects));
}
