// @flow
import * as THREE from "three";

import { document } from "libs/window";

let renderer = null;
function getRenderer() {
  if (renderer != null) {
    return renderer;
  }
  renderer =
    typeof document !== "undefined" && document.getElementById
      ? new THREE.WebGLRenderer({
          canvas: document.getElementById("render-canvas"),
          // This prevents flickering when rendering to a buffer instead of the canvas
          preserveDrawingBuffer: true,
          antialias: true,
        })
      : {};

  return renderer;
}

export { getRenderer };

export default {};
