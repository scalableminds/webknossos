// @flow
import * as THREE from "three";

import { document } from "libs/window";

let renderer = null;
function getRenderer() {
  if (renderer != null) {
    return renderer;
  }
  const renderCanvasElement = document.getElementById("render-canvas");
  renderer =
    renderCanvasElement != null
      ? new THREE.WebGLRenderer({
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
