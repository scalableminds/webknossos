/**
 * plane_view.js
 * @flow
 */
import _ from "lodash";
import app from "app";
import BackboneEvents from "backbone-events-standalone";
import TWEEN from "tween.js";
import * as THREE from "three";
import Store from "oxalis/store";
import Constants, { OrthoViews, OrthoViewValues, OrthoViewColors } from "oxalis/constants";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import type { OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import SceneController from "oxalis/controller/scene_controller";

// viewport render utils

export const setupRenderArea = (
  renderer: THREE.WebGLRenderer,
  x: number,
  y: number,
  fullExtent: number,
  width: number,
  height: number,
  color: number,
) => {
  renderer.setViewport(x, y, fullExtent, fullExtent);
  renderer.setScissor(x, y, width, height);
  renderer.setScissorTest(true);
  renderer.setClearColor(color, 1);
};

export const clearCanvas = (renderer: THREE.WebGLRenderer) => {
  const rendererSize = renderer.getSize();
  setupRenderArea(
    renderer,
    0,
    0,
    renderer.domElement.width,
    rendererSize.width,
    rendererSize.height,
    0xffffff,
  );
  renderer.clear();
};

export const getXYForId = (id: string, curWidth: number) => {
  const inputCatcherDOM = document.getElementById(`inputcatcher_${id}`);
  const layoutContainerDOM = document.getElementById("layoutContainer");
  if (!inputCatcherDOM || !layoutContainerDOM) {
    return [0, 0, 0, 0];
  }

  // if (inputCatcherDOM.closest(".lm_item_container").style.display) {
  //   return [0, 0, 0, 0];
  // }
  const itemContainer = inputCatcherDOM.closest(".lm_item_container");
  if (!itemContainer) {
    return [0, 0, 0, 0];
  }

  const { left: containerX, top: containerY } = layoutContainerDOM.getBoundingClientRect();
  const { left, top } = inputCatcherDOM.getBoundingClientRect();
  const { scrollWidth, scrollHeight } = itemContainer;

  // Returns the viewport's coordinates relative to the layout container (and the canvas)
  // Width and height is cropped to the visible width/height of the scrollable container
  return [
    left - containerX,
    top - containerY,
    Math.min(curWidth, scrollWidth),
    Math.min(curWidth, scrollHeight),
  ];
};

class PlaneView {
  // Copied form backbone events (TODO: handle this better)
  trigger: Function;
  listenTo: Function;

  cameras: OrthoViewMapType<THREE.OrthographicCamera>;

  running: boolean;
  needsRerender: boolean;
  curWidth: number;

  constructor() {
    _.extend(this, BackboneEvents);

    this.running = false;
    const { scene } = SceneController;

    // Create a 4x4 grid
    this.curWidth = Constants.VIEWPORT_WIDTH;

    // Initialize main THREE.js components
    this.cameras = {};

    for (const plane of OrthoViewValues) {
      // Let's set up cameras
      // No need to set any properties, because the cameras controller will deal with that
      this.cameras[plane] = new THREE.OrthographicCamera(0, 0, 0, 0);
      scene.add(this.cameras[plane]);
    }

    this.cameras[OrthoViews.PLANE_XY].position.z = -1;
    this.cameras[OrthoViews.PLANE_YZ].position.x = 1;
    this.cameras[OrthoViews.PLANE_XZ].position.y = 1;
    this.cameras[OrthoViews.TDView].position.copy(new THREE.Vector3(10, 10, -10));
    this.cameras[OrthoViews.PLANE_XY].up = new THREE.Vector3(0, -1, 0);
    this.cameras[OrthoViews.PLANE_YZ].up = new THREE.Vector3(0, -1, 0);
    this.cameras[OrthoViews.PLANE_XZ].up = new THREE.Vector3(0, 0, -1);
    this.cameras[OrthoViews.TDView].up = new THREE.Vector3(0, 0, -1);
    for (const plane of OrthoViewValues) {
      this.cameras[plane].lookAt(new THREE.Vector3(0, 0, 0));
    }

    this.needsRerender = true;
    app.vent.on("rerender", () => {
      this.needsRerender = true;
    });
    Store.subscribe(() => {
      // Render in the next frame after the change propagated everywhere
      window.requestAnimationFrame(() => {
        this.needsRerender = true;
      });
    });

    listenToStoreProperty(
      store => store.userConfiguration.scale,
      () => {
        if (this.running) {
          this.resizeThrottled();
        }
      },
    );
  }

  animate(): void {
    if (!this.running) {
      return;
    }

    this.renderFunction();

    window.requestAnimationFrame(() => this.animate());
  }

  renderOrthoViewToTexture(plane: OrthoViewType, scene: THREE.Scene): Uint8Array {
    const { renderer } = SceneController;

    renderer.autoClear = true;
    renderer.setViewport(0, 0, this.curWidth, this.curWidth);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 1);

    const renderTarget = new THREE.WebGLRenderTarget(this.curWidth, this.curWidth);
    const buffer = new Uint8Array(this.curWidth * this.curWidth * 4);

    SceneController.updateSceneForCam(plane);
    renderer.render(scene, this.cameras[plane], renderTarget);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, this.curWidth, this.curWidth, buffer);
    return buffer;
  }

  renderFunction(forceRender: boolean = false): void {
    // This is the main render function.
    // All 3D meshes and the trianglesplane are rendered here.

    TWEEN.update();

    // skip rendering if nothing has changed
    // This prevents the GPU/CPU from constantly
    // working and keeps your lap cool
    // ATTENTION: this limits the FPS to 60 FPS (depending on the keypress update frequence)

    if (forceRender || this.needsRerender || window.needsRerender) {
      window.needsRerender = false;
      const { renderer, scene } = SceneController;

      this.trigger("render");

      const viewport = {
        [OrthoViews.PLANE_XY]: getXYForId("PLANE_XY", this.curWidth),
        [OrthoViews.PLANE_YZ]: getXYForId("PLANE_YZ", this.curWidth),
        [OrthoViews.PLANE_XZ]: getXYForId("PLANE_XZ", this.curWidth),
        [OrthoViews.TDView]: getXYForId("TDView", this.curWidth),
      };
      renderer.autoClear = true;

      clearCanvas(renderer);

      for (const plane of OrthoViewValues) {
        SceneController.updateSceneForCam(plane);
        const [x, y, width, height] = viewport[plane];
        if (width > 0 && height > 0) {
          setupRenderArea(renderer, x, y, this.curWidth, width, height, OrthoViewColors[plane]);
          renderer.render(scene, this.cameras[plane]);
        }
      }

      this.needsRerender = false;
    }
  }

  draw(): void {
    app.vent.trigger("rerender");
  }

  resizeThrottled = _.throttle((): void => {
    // throttle resize to avoid annoying flickering
    this.resize();
  }, Constants.RESIZE_THROTTLE_TIME);

  resize = (): void => {
    // Call this after the canvas was resized to fix the viewport
    const viewportWidth = Math.round(
      Store.getState().userConfiguration.scale * Constants.VIEWPORT_WIDTH,
    );
    this.curWidth = viewportWidth;

    const canvasAndLayoutContainer = document.getElementById("canvasAndLayoutContainer");
    if (canvasAndLayoutContainer) {
      const { width, height } = canvasAndLayoutContainer.getBoundingClientRect();
      SceneController.renderer.setSize(width, height);
    }

    for (const plane of OrthoViewValues) {
      this.cameras[plane].aspect = 1;
      this.cameras[plane].updateProjectionMatrix();
    }
    this.draw();
  };

  getCameras(): OrthoViewMapType<THREE.OrthographicCamera> {
    return this.cameras;
  }

  stop(): void {
    this.running = false;

    for (const plane of OrthoViewValues) {
      SceneController.scene.remove(this.cameras[plane]);
    }
  }

  start(): void {
    this.running = true;

    this.resize();
    this.animate();
  }
}

export default PlaneView;
