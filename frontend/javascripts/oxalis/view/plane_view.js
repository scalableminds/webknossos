/**
 * plane_view.js
 * @flow
 */
import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
import TWEEN from "tween.js";
import _ from "lodash";

import { getDesiredLayoutRect } from "oxalis/view/layouting/golden_layout_adapter";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import Constants, {
  type OrthoView,
  OrthoViewColors,
  type OrthoViewMap,
  OrthoViewValues,
  OrthoViews,
} from "oxalis/constants";
import Store from "oxalis/store";
import app from "app";
import getSceneController from "oxalis/controller/scene_controller_provider";
import window from "libs/window";

export const setupRenderArea = (
  renderer: THREE.WebGLRenderer,
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  color: number,
) => {
  renderer.setViewport(x, y, viewportWidth, viewportHeight);
  renderer.setScissor(x, y, viewportWidth, viewportHeight);
  renderer.setScissorTest(true);
  renderer.setClearColor(color, 1);
};

export const clearCanvas = (renderer: THREE.WebGLRenderer) => {
  setupRenderArea(renderer, 0, 0, renderer.domElement.width, renderer.domElement.height, 0xffffff);
  renderer.clear();
};

const createDirLight = (position, target, intensity, parent) => {
  const dirLight = new THREE.DirectionalLight(0xffffff, intensity);
  dirLight.color.setHSL(0.1, 1, 0.95);
  dirLight.position.set(...position);
  parent.add(dirLight);
  parent.add(dirLight.target);
  dirLight.target.position.set(...target);
  return dirLight;
};

const raycaster = new THREE.Raycaster();
const oldRaycasterHit = {
  object: null,
  color: null,
};

class PlaneView {
  // Copied form backbone events (TODO: handle this better)
  trigger: Function;
  listenTo: Function;
  unbindChangedScaleListener: () => void;

  cameras: OrthoViewMap<THREE.OrthographicCamera>;

  running: boolean;
  needsRerender: boolean;

  constructor() {
    _.extend(this, BackboneEvents);

    this.running = false;
    const { scene } = getSceneController();

    // Initialize main THREE.js components
    this.cameras = {};

    for (const plane of OrthoViewValues) {
      // Let's set up cameras
      // No need to set any properties, because the cameras controller will deal with that
      this.cameras[plane] = new THREE.OrthographicCamera(0, 0, 0, 0);
      scene.add(this.cameras[plane]);
    }

    createDirLight([10, 10, 10], [0, 0, 10], 5, this.cameras[OrthoViews.TDView]);

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

  renderOrthoViewToTexture(plane: OrthoView, scene: THREE.Scene): Uint8Array {
    const SceneController = getSceneController();
    const { renderer } = SceneController;

    renderer.autoClear = true;
    let { width, height } = getInputCatcherRect(Store.getState(), plane);
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
    const SceneController = getSceneController();

    // skip rendering if nothing has changed
    // This prevents the GPU/CPU from constantly
    // working and keeps your lap cool
    // ATTENTION: this limits the FPS to 60 FPS (depending on the keypress update frequence)

    if (forceRender || this.needsRerender || window.needsRerender) {
      window.needsRerender = false;
      const { renderer, scene } = SceneController;

      this.trigger("render");

      const storeState = Store.getState();
      const viewport = {
        [OrthoViews.PLANE_XY]: getInputCatcherRect(storeState, "PLANE_XY"),
        [OrthoViews.PLANE_YZ]: getInputCatcherRect(storeState, "PLANE_YZ"),
        [OrthoViews.PLANE_XZ]: getInputCatcherRect(storeState, "PLANE_XZ"),
        [OrthoViews.TDView]: getInputCatcherRect(storeState, "TDView"),
      };

      renderer.autoClear = true;

      clearCanvas(renderer);

      this.performHitTest();

      for (const plane of OrthoViewValues) {
        SceneController.updateSceneForCam(plane);
        const { left, top, width, height } = viewport[plane];
        if (width > 0 && height > 0) {
          setupRenderArea(renderer, left, top, width, height, OrthoViewColors[plane]);
          renderer.render(scene, this.cameras[plane]);
        }
      }

      this.needsRerender = false;
    }
  }

  performHitTest(): ?THREE.Vector3 {
    const storeState = Store.getState();
    const SceneController = getSceneController();
    const { scene, isosurfacesRootGroup } = SceneController;
    const tdViewport = getInputCatcherRect(storeState, "TDView");
    const { mousePosition } = storeState.temporaryConfiguration;
    if (mousePosition == null) {
      return null;
    }
    if (storeState.viewModeData.plane.activeViewport !== OrthoViews.TDView) {
      return null;
    }
    const mouse = new THREE.Vector2(
      (mousePosition[0] / tdViewport.width) * 2 - 1,
      ((mousePosition[1] / tdViewport.height) * 2 - 1) * -1, // y is inverted
    );

    raycaster.setFromCamera(mouse, this.cameras[OrthoViews.TDView]);

    const intersections = raycaster.intersectObjects(isosurfacesRootGroup.children, true);
    const hitObject = intersections.length > 0 ? intersections[0].object : null;
    if (hitObject === oldRaycasterHit.object) {
      // Do nothing, since we are hitting the same object
      return intersections.length > 0 ? intersections[0].point : null;
    }
    if (oldRaycasterHit.object != null) {
      oldRaycasterHit.object.parent.children.forEach(meshPart => {
        meshPart.material.emissive.setHex(oldRaycasterHit.color);
      });
      oldRaycasterHit.object = null;
    }
    if (hitObject != null) {
      const oldColor = hitObject.material.emissive.getHex();
      hitObject.parent.children.forEach(meshPart => {
        meshPart.material.emissive.setHSL(0.7, 0.5, 0.1);
      });

      oldRaycasterHit.object = hitObject;
      oldRaycasterHit.color = oldColor;
      return intersections[0].point;
    } else {
      oldRaycasterHit.object = null;
      return null;
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
    const { width, height } = getDesiredLayoutRect();
    getSceneController().renderer.setSize(width, height);
    this.draw();
  };

  getCameras(): OrthoViewMap<THREE.OrthographicCamera> {
    return this.cameras;
  }

  stop(): void {
    this.running = false;

    for (const plane of OrthoViewValues) {
      getSceneController().scene.remove(this.cameras[plane]);
    }
    window.removeEventListener("resize", this.resizeThrottled);
    this.unbindChangedScaleListener();
  }

  start(): void {
    this.running = true;
    this.resize();
    this.animate();

    window.addEventListener("resize", this.resizeThrottled);
    this.unbindChangedScaleListener = listenToStoreProperty(
      store => store.userConfiguration.layoutScaleValue,
      this.resizeThrottled,
    );
  }
}

export default PlaneView;
