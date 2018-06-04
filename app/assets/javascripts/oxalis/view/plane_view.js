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
import type { OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import SceneController from "oxalis/controller/scene_controller";
import { getDesiredCanvasSize } from "oxalis/view/layouting/tracing_layout_view";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";

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

class PlaneView {
  // Copied form backbone events (TODO: handle this better)
  trigger: Function;
  listenTo: Function;

  cameras: OrthoViewMapType<THREE.OrthographicCamera>;

  running: boolean;
  needsRerender: boolean;

  constructor() {
    _.extend(this, BackboneEvents);

    this.running = false;
    const { scene } = SceneController;

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
    let { width, height } = getInputCatcherRect(plane);
    width = Math.round(width);
    height = Math.round(height);

    renderer.setViewport(0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 1);

    const renderTarget = new THREE.WebGLRenderTarget(width, height);
    const buffer = new Uint8Array(width * height * 4);

    SceneController.updateSceneForCam(plane);
    renderer.render(scene, this.cameras[plane], renderTarget);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, buffer);
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
        [OrthoViews.PLANE_XY]: getInputCatcherRect("PLANE_XY"),
        [OrthoViews.PLANE_YZ]: getInputCatcherRect("PLANE_YZ"),
        [OrthoViews.PLANE_XZ]: getInputCatcherRect("PLANE_XZ"),
        [OrthoViews.TDView]: getInputCatcherRect("TDView"),
      };

      renderer.autoClear = true;

      clearCanvas(renderer);

      for (const plane of OrthoViewValues) {
        SceneController.updateSceneForCam(plane);
        const { left, top, width, height } = viewport[plane];
        if (width > 0 && height > 0) {
          setupRenderArea(
            renderer,
            left,
            top,
            Math.min(width, height),
            width,
            height,
            OrthoViewColors[plane],
          );
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
    // todo: is this still called?
    // throttle resize to avoid annoying flickering
    this.resize();
  }, Constants.RESIZE_THROTTLE_TIME);

  resize = (): void => {
    getDesiredCanvasSize().map(([width, height]) =>
      SceneController.renderer.setSize(width, height),
    );

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
    window.removeEventListener("resize", this.resize);
  }

  start(): void {
    this.running = true;
    this.resize();
    this.animate();

    window.addEventListener("resize", this.resize);
  }
}

export default PlaneView;
