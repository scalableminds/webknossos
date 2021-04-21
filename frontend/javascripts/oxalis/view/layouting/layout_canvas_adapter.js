// @flow

import { OUTER_CSS_BORDER, type Rect } from "oxalis/constants";
import { document } from "libs/window";

export default function makeRectRelativeToCanvas(rect: Rect): Rect {
  const layoutContainerDOM = document.getElementById("render-canvas");
  if (!layoutContainerDOM) {
    return rect;
  }
  const { left: containerX, top: containerY } = layoutContainerDOM.getBoundingClientRect();

  const borderWidth = OUTER_CSS_BORDER;
  const minNull = el => Math.max(el, 0);

  // Since we want to paint inside the InputCatcher we have to subtract the border
  return {
    left: minNull(rect.left - containerX + borderWidth),
    top: minNull(rect.top - containerY + borderWidth),
    width: minNull(rect.width - 2 * borderWidth),
    height: minNull(rect.height - 2 * borderWidth),
  };
}
