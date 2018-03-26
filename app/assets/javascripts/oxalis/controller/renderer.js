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
      : {
          getContext: () => ({
            MAX_TEXTURE_SIZE: 0,
            MAX_COMBINED_TEXTURE_IMAGE_UNITS: 8,
            getParameter: (param: number) => 0,
          }),
        };

  return renderer;
}

export { getRenderer };

export default {};
