import * as THREE from "three";
import { document } from "libs/window";
// @ts-expect-error ts-migrate(7034) FIXME: Variable 'renderer' implicitly has type 'any' in s... Remove this comment to see the full error message
let renderer = null;

function getRenderer() {
  // @ts-expect-error ts-migrate(7005) FIXME: Variable 'renderer' implicitly has an 'any' type.
  if (renderer != null) {
    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'renderer' implicitly has an 'any' type.
    return renderer;
  }

  const renderCanvasElement = document.getElementById("render-canvas");
  renderer =
    renderCanvasElement != null
      ? new THREE.WebGLRenderer({
          // @ts-expect-error ts-migrate(2322) FIXME: Type 'HTMLElement' is not assignable to type 'HTML... Remove this comment to see the full error message
          canvas: renderCanvasElement,
          // This prevents flickering when rendering to a buffer instead of the canvas
          preserveDrawingBuffer: true,
          antialias: true,
        })
      : {};
  return renderer;
}

export { getRenderer };
export default {};
