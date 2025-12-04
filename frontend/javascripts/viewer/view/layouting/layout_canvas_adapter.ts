import { document } from "libs/window";
import type { Rect } from "viewer/constants";

export default function makeRectRelativeToCanvas(rect: Rect): Rect {
  const layoutContainerDOM = document.getElementById("render-canvas");

  if (!layoutContainerDOM) {
    return rect;
  }

  const { left: containerX, top: containerY } = layoutContainerDOM.getBoundingClientRect();
  const minNull = (el: number) => Math.max(el, 0);

  // Since we want to paint inside the InputCatcher we have to subtract the border
  return {
    left: minNull(rect.left - containerX),
    top: minNull(rect.top - containerY),
    width: minNull(rect.width),
    height: minNull(rect.height),
  };
}
