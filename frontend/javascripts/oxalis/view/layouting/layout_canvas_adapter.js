// @flow

import { OUTER_CSS_BORDER, type Rect } from "oxalis/constants";
import { document } from "libs/window";

export default function makeRectRelativeToCanvas(rect: Rect): Rect {
  const layoutContainerDOM = document.getElementById("layoutContainer");
  if (!layoutContainerDOM) {
    return rect;
  }
  const { left: containerX, top: containerY } = layoutContainerDOM.getBoundingClientRect();

  const borderWidth = OUTER_CSS_BORDER;

  // Since we want to paint inside the InputCatcher we have to subtract the border
  return {
    left: rect.left - containerX + borderWidth,
    top: rect.top - containerY + borderWidth,
    width: rect.width - 2 * borderWidth,
    height: rect.height - 2 * borderWidth,
  };
}
