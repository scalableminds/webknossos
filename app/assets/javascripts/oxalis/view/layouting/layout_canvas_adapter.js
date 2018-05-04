// @flow

import type { Rect } from "oxalis/constants";

export default function makeRectRelativeToCanvas(rect: ?Rect): ?Rect {
  if (!rect) {
    return rect;
  }
  const layoutContainerDOM = document.getElementById("layoutContainer");
  if (!layoutContainerDOM) {
    return null;
  }
  const { left: containerX, top: containerY } = layoutContainerDOM.getBoundingClientRect();

  return {
    left: rect.left - containerX,
    top: rect.top - containerY,
    width: rect.width,
    height: rect.height,
  };
}
