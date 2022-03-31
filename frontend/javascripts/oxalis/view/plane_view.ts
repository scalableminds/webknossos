// @flow
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'back... Remove this comment to see the full error message
import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'twee... Remove this comment to see the full error message
import TWEEN from "tween.js";
import _ from "lodash";
import { getGroundTruthLayoutRect } from "oxalis/view/layouting/default_layout_configs";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import { updateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import type { OrthoViewMap } from "oxalis/constants";
import Constants, { OrthoViewColors, OrthoViewValues, OrthoViews } from "oxalis/constants";
import Store from "oxalis/store";
import app from "app";
import getSceneController from "oxalis/controller/scene_controller_provider";
import window from "libs/window";
import { clearCanvas, setupRenderArea } from "oxalis/view/rendering_utils";

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'position' implicitly has an 'any' type.
const createDirLight = (position, target, intensity, parent) => {
  const dirLight = new THREE.DirectionalLight(0xffffff, intensity);
  dirLight.color.setHSL(0.1, 1, 0.95);
  // @ts-expect-error ts-migrate(2556) FIXME: Expected 3 arguments, but got 0 or more.
  dirLight.position.set(...position);
  parent.add(dirLight);
  parent.add(dirLight.target);
  // @ts-expect-error ts-migrate(2556) FIXME: Expected 3 arguments, but got 0 or more.
  dirLight.target.position.set(...target);
  return dirLight;
};

const raycaster = new THREE.Raycaster();
// @ts-expect-error ts-migrate(7034) FIXME: Variable 'oldRaycasterHit' implicitly has type 'an... Remove this comment to see the full error message
let oldRaycasterHit = null;
const ISOSURFACE_HOVER_THROTTLING_DELAY = 150;

class PlaneView {
  // Copied form backbone events (TODO: handle this better)
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'trigger' has no initializer and is not d... Remove this comment to see the full error message
  trigger: (...args: Array<any>) => any;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'listenTo' has no initializer and is not ... Remove this comment to see the full error message
  listenTo: (...args: Array<any>) => any;
  cameras: OrthoViewMap<typeof THREE.OrthographicCamera>;
  throttledPerformIsosurfaceHitTest: (
    arg0: [number, number],
  ) => typeof THREE.Vector3 | null | undefined;

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
      // @ts-expect-error ts-migrate(2739) FIXME: Type 'OrthographicCamera' is missing the following... Remove this comment to see the full error message
      this.cameras[plane] = new THREE.OrthographicCamera(0, 0, 0, 0);
      // This name can be used to retrieve the camera from the scene
      // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'name' because it is a read-only ... Remove this comment to see the full error message
      this.cameras[plane].name = plane;
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'add' does not exist on type 'typeof Scen... Remove this comment to see the full error message
      scene.add(this.cameras[plane]);
    }

    createDirLight([10, 10, 10], [0, 0, 10], 5, this.cameras[OrthoViews.TDView]);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'typeof... Remove this comment to see the full error message
    this.cameras[OrthoViews.PLANE_XY].position.z = -1;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'typeof... Remove this comment to see the full error message
    this.cameras[OrthoViews.PLANE_YZ].position.x = 1;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'typeof... Remove this comment to see the full error message
    this.cameras[OrthoViews.PLANE_XZ].position.y = 1;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'typeof... Remove this comment to see the full error message
    this.cameras[OrthoViews.TDView].position.copy(new THREE.Vector3(10, 10, -10));
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'up' does not exist on type 'typeof Ortho... Remove this comment to see the full error message
    this.cameras[OrthoViews.PLANE_XY].up = new THREE.Vector3(0, -1, 0);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'up' does not exist on type 'typeof Ortho... Remove this comment to see the full error message
    this.cameras[OrthoViews.PLANE_YZ].up = new THREE.Vector3(0, -1, 0);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'up' does not exist on type 'typeof Ortho... Remove this comment to see the full error message
    this.cameras[OrthoViews.PLANE_XZ].up = new THREE.Vector3(0, 0, -1);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'up' does not exist on type 'typeof Ortho... Remove this comment to see the full error message
    this.cameras[OrthoViews.TDView].up = new THREE.Vector3(0, 0, -1);

    for (const plane of OrthoViewValues) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'lookAt' does not exist on type 'typeof O... Remove this comment to see the full error message
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

  renderFunction(forceRender: boolean = false): void {
    // This is the main render function.
    // All 3D meshes and the trianglesplane are rendered here.
    TWEEN.update();
    const SceneController = getSceneController();

    // skip rendering if nothing has changed
    // This prevents the GPU/CPU from constantly
    // working and keeps your lap cool
    // ATTENTION: this limits the FPS to 60 FPS (depending on the keypress update frequence)
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'needsRerender' does not exist on type '(... Remove this comment to see the full error message
    if (forceRender || this.needsRerender || window.needsRerender) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'needsRerender' does not exist on type '(... Remove this comment to see the full error message
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
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'autoClear' does not exist on type 'typeo... Remove this comment to see the full error message
      renderer.autoClear = true;
      clearCanvas(renderer);

      for (const plane of OrthoViewValues) {
        SceneController.updateSceneForCam(plane);
        const { left, top, width, height } = viewport[plane];

        if (width > 0 && height > 0) {
          setupRenderArea(renderer, left, top, width, height, OrthoViewColors[plane]);
          // @ts-expect-error ts-migrate(2339) FIXME: Property 'render' does not exist on type 'typeof W... Remove this comment to see the full error message
          renderer.render(scene, this.cameras[plane]);
        }
      }

      this.needsRerender = false;
    }
  }

  performIsosurfaceHitTest(
    mousePosition: [number, number],
  ): typeof THREE.Vector3 | null | undefined {
    const storeState = Store.getState();
    const SceneController = getSceneController();
    const { isosurfacesRootGroup } = SceneController;
    const tdViewport = getInputCatcherRect(storeState, "TDView");
    const { hoveredSegmentId } = storeState.temporaryConfiguration;

    // Outside of the 3D viewport, we don't do isosurface hit tests
    if (storeState.viewModeData.plane.activeViewport !== OrthoViews.TDView) {
      if (hoveredSegmentId !== 0) {
        // Reset hoveredSegmentId if we are outside of the 3D viewport,
        // since that id takes precedence over the shader-calculated cell id
        // under the mouse cursor
        Store.dispatch(updateTemporarySettingAction("hoveredSegmentId", 0));
      }

      return null;
    }

    // Perform ray casting
    const mouse = new THREE.Vector2(
      (mousePosition[0] / tdViewport.width) * 2 - 1,
      ((mousePosition[1] / tdViewport.height) * 2 - 1) * -1,
    );
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'typeof OrthographicCamera' is no... Remove this comment to see the full error message
    raycaster.setFromCamera(mouse, this.cameras[OrthoViews.TDView]);
    // The second parameter of intersectObjects is set to true to ensure that
    // the groups which contain the actual meshes are traversed.
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'children' does not exist on type 'typeof... Remove this comment to see the full error message
    const intersections = raycaster.intersectObjects(isosurfacesRootGroup.children, true);
    const hitObject = intersections.length > 0 ? intersections[0].object : null;

    // Check whether we are hitting the same object as before, since we can return early
    // in this case.
    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'oldRaycasterHit' implicitly has an 'any'... Remove this comment to see the full error message
    if (hitObject === oldRaycasterHit) {
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'Vector3 | null' is not assignable to type 't... Remove this comment to see the full error message
      return intersections.length > 0 ? intersections[0].point : null;
    }

    // Undo highlighting of old hit
    // @ts-expect-error ts-migrate(7005) FIXME: Variable 'oldRaycasterHit' implicitly has an 'any'... Remove this comment to see the full error message
    if (oldRaycasterHit != null) {
      // @ts-expect-error ts-migrate(7005) FIXME: Variable 'oldRaycasterHit' implicitly has an 'any'... Remove this comment to see the full error message
      oldRaycasterHit.parent.children.forEach((meshPart) => {
        meshPart.material.emissive.setHex("#000000");
      });
      oldRaycasterHit = null;
    }

    oldRaycasterHit = hitObject;

    // Highlight new hit
    if (hitObject != null) {
      const hoveredColor = [0.7, 0.5, 0.1];
      // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
      hitObject.parent.children.forEach((meshPart) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'material' does not exist on type 'Object... Remove this comment to see the full error message
        meshPart.material.emissive.setHSL(...hoveredColor);
      });
      // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
      Store.dispatch(updateTemporarySettingAction("hoveredSegmentId", hitObject.parent.cellId));
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'Vector3' is not assignable to type 'typeof V... Remove this comment to see the full error message
      return intersections[0].point;
    } else {
      Store.dispatch(updateTemporarySettingAction("hoveredSegmentId", 0));
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
    const { width, height } = getGroundTruthLayoutRect();
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'setSize' does not exist on type 'typeof ... Remove this comment to see the full error message
    getSceneController().renderer.setSize(width, height);
    this.draw();
  };

  getCameras(): OrthoViewMap<typeof THREE.OrthographicCamera> {
    return this.cameras;
  }

  stop(): void {
    this.running = false;

    for (const plane of OrthoViewValues) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'remove' does not exist on type 'typeof S... Remove this comment to see the full error message
      getSceneController().scene.remove(this.cameras[plane]);
    }

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'removeEventListener' does not exist on t... Remove this comment to see the full error message
    window.removeEventListener("resize", this.resizeThrottled);
  }

  start(): void {
    this.running = true;
    this.resize();
    this.animate();
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'addEventListener' does not exist on type... Remove this comment to see the full error message
    window.addEventListener("resize", this.resizeThrottled);
  }
}

export default PlaneView;
