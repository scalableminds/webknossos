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

function testContextLoss() {
  const renderer = getRenderer();
  const ext = renderer.getContext().getExtension("WEBGL_lose_context");
  if (ext == null) {
    return;
  }
  ext.loseContext();
  setTimeout(() => ext.restoreContext(), 2500);
  // renderer.domElement.addEventListener("webglcontextrestored", function (event) {
  //   renderer.getContext();
  //   const scene = window.scene;
  //   const updateMaterial = function (material) {
  //     material.needsUpdate = true;
  //     for (var key in material)
  //       if (material[key] && material[key].isTexture) {
  //         material[key].needsUpdate = true;
  //       }
  //   };
  //   scene.traverse(function (object) {
  //     if (object.geometry) {
  //       for (var key in object.geometry.attributes) {
  //         object.geometry.attributes[key].needsUpdate = true;
  //       }
  //       if (object.geometry.index) {
  //         object.geometry.index.needsUpdate = true;
  //       }
  //     }
  //     if (object.material) {
  //       if (object.material.length) {
  //         object.material.forEach(updateMaterial);
  //       } else {
  //         updateMaterial(object.material);
  //       }
  //     }
  //   });
  //   try {
  //     scene.backgound.needsUpdate = true;
  //   } catch (e) {}
  // });
}

window.testContextLoss = testContextLoss;

export { getRenderer };
export default {};
