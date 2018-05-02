// @flow
import * as THREE from "three";

let renderer = null;
function getRenderer() {
  if (renderer != null) {
    return renderer;
  }
  renderer =
    typeof document !== "undefined" && document.getElementById
      ? new THREE.WebGLRenderer({
          canvas: document.getElementById("render-canvas"),
          antialias: true,
        })
      : {};

  return renderer;
}

export { getRenderer };

export default {};
