// @flow
import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
import TWEEN from "tween.js";
import _ from "lodash";

import { getDesiredLayoutRect } from "oxalis/view/layouting/golden_layout_adapter";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { updateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import Constants, {
  OrthoViewColors,
  type OrthoViewMap,
  OrthoViewValues,
  OrthoViews,
} from "oxalis/constants";
import Store from "oxalis/store";
import app from "app";
import getSceneController from "oxalis/controller/scene_controller_provider";
import window from "libs/window";
import { clearCanvas, setupRenderArea } from "oxalis/view/rendering_utils";

window.PIXEL_RATIO_FACTOR = 0.5;

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
let oldRaycasterHit = null;

const ISOSURFACE_HOVER_THROTTLING_DELAY = 150;

class PlaneView {
  // Copied form backbone events (TODO: handle this better)
  trigger: Function;
  listenTo: Function;
  unbindChangedScaleListener: () => void;

  cameras: OrthoViewMap<THREE.OrthographicCamera>;
  throttledPerformIsosurfaceHitTest: () => ?THREE.Vector3;

  running: boolean;
  needsRerender: boolean;

  constructor() {
    _.extend(this, BackboneEvents);
    this.throttledPerformIsosurfaceHitTest = _.throttle(
      this.performIsosurfaceHitTest,
      ISOSURFACE_HOVER_THROTTLING_DELAY,
    );

    this.running = false;
    const { scene } = getSceneController();

    // Initialize main THREE.js components
    this.cameras = {};

    for (const plane of OrthoViewValues) {
      // Let's set up cameras
      // No need to set any properties, because the cameras controller will deal with that
      this.cameras[plane] = new THREE.OrthographicCamera(0, 0, 0, 0);
      // This name can be used to retrieve the camera from the scene
      this.cameras[plane].name = plane;
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

  renderFunction(forceRender: boolean = false, targetPlaneId = null): void {
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

      // clearCanvas(renderer);

      this.throttledPerformIsosurfaceHitTest();

      for (const plane of OrthoViewValues) {
        // if (targetPlaneId != null && plane != targetPlaneId) {
        //   continue;
        // }
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

  performIsosurfaceHitTest(): ?THREE.Vector3 {
    const storeState = Store.getState();
    const SceneController = getSceneController();
    const { isosurfacesRootGroup } = SceneController;
    const tdViewport = getInputCatcherRect(storeState, "TDView");
    const { mousePosition, hoveredIsosurfaceId } = storeState.temporaryConfiguration;

    if (mousePosition == null) {
      return null;
    }

    // Outside of the 3D viewport, we don't do isosurface hit tests
    if (storeState.viewModeData.plane.activeViewport !== OrthoViews.TDView) {
      if (hoveredIsosurfaceId !== 0) {
        // Reset hoveredIsosurfaceId if we are outside of the 3D viewport,
        // since that id takes precedence over the shader-calculated cell id
        // under the mouse cursor
        Store.dispatch(updateTemporarySettingAction("hoveredIsosurfaceId", 0));
      }
      return null;
    }

    // Perform ray casting
    const mouse = new THREE.Vector2(
      (mousePosition[0] / tdViewport.width) * 2 - 1,
      ((mousePosition[1] / tdViewport.height) * 2 - 1) * -1, // y is inverted
    );

    raycaster.setFromCamera(mouse, this.cameras[OrthoViews.TDView]);
    // The second parameter of intersectObjects is set to true to ensure that
    // the groups which contain the actual meshes are traversed.
    const intersections = raycaster.intersectObjects(isosurfacesRootGroup.children, true);
    const hitObject = intersections.length > 0 ? intersections[0].object : null;

    // Check whether we are hitting the same object as before, since we can return early
    // in this case.
    if (hitObject === oldRaycasterHit) {
      return intersections.length > 0 ? intersections[0].point : null;
    }

    // Undo highlighting of old hit
    if (oldRaycasterHit != null) {
      oldRaycasterHit.parent.children.forEach(meshPart => {
        meshPart.material.emissive.setHex("#000000");
      });
      oldRaycasterHit = null;
    }

    oldRaycasterHit = hitObject;

    // Highlight new hit
    if (hitObject != null) {
      const hoveredColor = [0.7, 0.5, 0.1];
      hitObject.parent.children.forEach(meshPart => {
        meshPart.material.emissive.setHSL(...hoveredColor);
      });

      Store.dispatch(updateTemporarySettingAction("hoveredIsosurfaceId", hitObject.parent.cellId));
      return intersections[0].point;
    } else {
      Store.dispatch(updateTemporarySettingAction("hoveredIsosurfaceId", 0));
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
    const { renderer } = getSceneController();

    renderer.setPixelRatio(window.PIXEL_RATIO_FACTOR);
    renderer.setSize(width * window.PIXEL_RATIO_FACTOR, height * window.PIXEL_RATIO_FACTOR);

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

    window.rerenderNow = targetPlaneId => this.renderFunction(true, targetPlaneId);

    window.addEventListener("resize", this.resizeThrottled);
    this.unbindChangedScaleListener = listenToStoreProperty(
      store => store.userConfiguration.layoutScaleValue,
      this.resizeThrottled,
    );
  }
}

export default PlaneView;
