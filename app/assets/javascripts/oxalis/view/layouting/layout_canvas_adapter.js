// @flow

import type { Rect } from "oxalis/constants";
import { document } from "libs/window";

export default function makeRectRelativeToCanvas(rect: Rect): Rect {
  const layoutContainerDOM = document.getElementById("layoutContainer");
  if (!layoutContainerDOM) {
    return rect;
  }
  const { left: containerX, top: containerY } = layoutContainerDOM.getBoundingClientRect();

  const borderWidth = 2;

  // Since we want to paint inside the InputCatcher we have to subtract the border
  return {
    left: rect.left - containerX + borderWidth + 1, // it's not entirely clear to my why the +1
    top: rect.top - containerY + borderWidth - 1, // and -1 are necessary.
    width: rect.width - 2 * borderWidth,
    height: rect.height - 2 * borderWidth,
  };
}
