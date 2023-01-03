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

if (typeof window !== "undefined") {
  // Call window.testContextLoss() in the console
  // to test the context loss recovery.
  function testContextLoss() {
    const renderer = getRenderer();
    const ext = renderer.getContext().getExtension("WEBGL_lose_context");
    if (ext == null) {
      return;
    }
    ext.loseContext();
    setTimeout(() => ext.restoreContext(), 2500);
  }
  // @ts-ignore
  window.testContextLoss = testContextLoss;
}

export { getRenderer };
export default {};
