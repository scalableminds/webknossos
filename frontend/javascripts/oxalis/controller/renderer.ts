import { notifyAboutDisposedRenderer } from "libs/UpdatableTexture";
import { document } from "libs/window";
import { Store } from "oxalis/singletons";
import * as THREE from "three";

let renderer: THREE.WebGLRenderer | null = null;

export function destroyRenderer(): void {
  if (renderer == null) {
    return;
  }
  renderer.dispose();
  renderer = null;
  notifyAboutDisposedRenderer();
}

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
          // Apparently, there's a bug in the antialias implementation of browsers so that
          // varyings that are marked with a flat modifier are still being interpolated.
          // This caused 1-fragment-wide stripes in the rendering output. Debugging the shader code
          // showed that the bucket addresses which are passed from vertex to fragment shader
          // were interpolated sometimes. Disabling antialiasing helped a bit for that, but there
          // were still problems which is why the fragment shader doesn't use the flat varying
          // for texels close to the bucket borders. Consequently, antialiasing can be enabled
          // without problems (probably) apart from a potential performance drop.
          antialias: Store.getState().userConfiguration.antialiasRendering,
        })
      : {}
  ) as THREE.WebGLRenderer;

  renderer.physicallyCorrectLights = true;

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
