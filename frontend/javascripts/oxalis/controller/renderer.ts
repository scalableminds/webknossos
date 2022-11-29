import * as THREE from "three";
import { document } from "libs/window";
let renderer: THREE.WebGLRenderer | null = null;

function getRenderer(): THREE.WebGLRenderer {
  if (renderer != null) {
    return renderer;
  }

  const renderCanvasElement = document.getElementById("render-canvas");
  renderer = (
    renderCanvasElement != null
      ? // Create a WebGL2 renderer
        new THREE.WebGLRenderer({
          canvas: renderCanvasElement,
          // This prevents flickering when rendering to a buffer instead of the canvas
          preserveDrawingBuffer: true,
          antialias: true,
        })
      : {}
  ) as THREE.WebGLRenderer;

  return renderer;
}

export { getRenderer };
export default {};
