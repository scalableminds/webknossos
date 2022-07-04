// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'back... Remove this comment to see the full error message
import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'twee... Remove this comment to see the full error message
import TWEEN from "tween.js";
import _ from "lodash";
import { getGroundTruthLayoutRect } from "oxalis/view/layouting/default_layout_configs";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { updateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import Constants, {
  OrthoViewCameraMap,
  AnyCamera,
  Vector3,
  TDCameras,
  OrthoViewColors,
  OrthoViewValues,
  OrthoViews,
  OrthoViewValuesWithoutTDView,
} from "oxalis/constants";
import Store from "oxalis/store";
import app from "app";
import getSceneController from "oxalis/controller/scene_controller_provider";
import window from "libs/window";
import { clearCanvas, setupRenderArea } from "oxalis/view/rendering_utils";
import { allCameras, forBothTdCameras } from "oxalis/controller/camera_controller";

const createDirLight = (
  position: Vector3,
  target: Vector3,
  intensity: number,
  parent: AnyCamera,
) => {
  const dirLight = new THREE.DirectionalLight(0xffffff, intensity);
  dirLight.color.setHSL(0.1, 1, 0.95);
  dirLight.position.set(...position);
  parent.add(dirLight);
  parent.add(dirLight.target);
  dirLight.target.position.set(...target);
  return dirLight;
};

const raycaster = new THREE.Raycaster();
let oldRaycasterHit: THREE.Object3D | null = null;
const ISOSURFACE_HOVER_THROTTLING_DELAY = 150;

class PlaneView {
  // Copied form backbone events (TODO: handle this better)
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'trigger' has no initializer and is not d... Remove this comment to see the full error message
  trigger: (...args: Array<any>) => any;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'listenTo' has no initializer and is not ... Remove this comment to see the full error message
  listenTo: (...args: Array<any>) => any;
  cameras: OrthoViewCameraMap;
  throttledPerformIsosurfaceHitTest: (arg0: [number, number]) => THREE.Vector3 | null | undefined;
  storePropertyUnsubscribers: Array<(...args: Array<any>) => any>;
  tdViewUseOrthographicCamera: boolean;

  running: boolean;
  needsRerender: boolean;

  constructor() {
    _.extend(this, BackboneEvents);
    this.storePropertyUnsubscribers = [];
    this.tdViewUseOrthographicCamera = true;
    this.bindToEvents();
    this.throttledPerformIsosurfaceHitTest = _.throttle(
      this.performIsosurfaceHitTest,
      ISOSURFACE_HOVER_THROTTLING_DELAY,
    );
    this.running = false;
    const { scene } = getSceneController();
    // Initialize main THREE.js components
    const partialCameraMap: any = {};

    const getNewCamera = (name: string, isOrthographic: boolean) => {
      // No need to set any properties, because the cameras controller will deal with that
      const newCamera = isOrthographic
        ? new THREE.OrthographicCamera(0, 0, 0, 0)
        : new THREE.PerspectiveCamera(45, 1, 50, 1000);
      // This name can be used to retrieve the camera from the scene
      newCamera.name = name;
      scene.add(newCamera);
      return newCamera;
    };

    for (const plane of OrthoViewValuesWithoutTDView) {
      // Let's set up cameras
      partialCameraMap[plane] = getNewCamera(plane, true);
    }
    partialCameraMap[OrthoViews.TDView] = {
      [TDCameras.OrthographicCamera]: getNewCamera(`${OrthoViews.TDView}_Orthographic`, true),
      [TDCameras.PerspectiveCamera]: getNewCamera(`${OrthoViews.TDView}_Perspective`, false),
    };
    const cameras: OrthoViewCameraMap = partialCameraMap;
    this.cameras = cameras;
    forBothTdCameras((camera) => {
      createDirLight([10, 10, 10], [0, 0, 10], 5, camera);
      camera.position.copy(new THREE.Vector3(10, 10, -10));
      camera.up = new THREE.Vector3(0, 0, -1);
    }, this.cameras[OrthoViews.TDView]);
    this.cameras[OrthoViews.PLANE_XY].position.z = -1;
    this.cameras[OrthoViews.PLANE_YZ].position.x = 1;
    this.cameras[OrthoViews.PLANE_XZ].position.y = 1;
    this.cameras[OrthoViews.PLANE_XY].up = new THREE.Vector3(0, -1, 0);
    this.cameras[OrthoViews.PLANE_YZ].up = new THREE.Vector3(0, -1, 0);
    this.cameras[OrthoViews.PLANE_XZ].up = new THREE.Vector3(0, 0, -1);

    for (const camera of allCameras(this.cameras)) {
      camera.lookAt(new THREE.Vector3(0, 0, 0));
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
      renderer.autoClear = true;
      clearCanvas(renderer);
      console.log(
        "rotation",
        this.cameras[OrthoViews.TDView][TDCameras.OrthographicCamera].quaternion,
        this.cameras[OrthoViews.TDView][TDCameras.PerspectiveCamera].quaternion,
      );
      console.log(
        "position",
        this.cameras[OrthoViews.TDView][TDCameras.OrthographicCamera].position,
        this.cameras[OrthoViews.TDView][TDCameras.PerspectiveCamera].position,
      );
      for (const plane of OrthoViewValues) {
        SceneController.updateSceneForCam(plane);
        const { left, top, width, height } = viewport[plane];

        if (width > 0 && height > 0) {
          setupRenderArea(renderer, left, top, width, height, OrthoViewColors[plane]);
          if (plane === OrthoViews.TDView) {
            if (this.tdViewUseOrthographicCamera) {
              renderer.render(scene, this.cameras[plane][TDCameras.OrthographicCamera]);
            } else {
              renderer.render(scene, this.cameras[plane][TDCameras.PerspectiveCamera]);
            }
          } else {
            renderer.render(scene, this.cameras[plane]);
          }
        }
      }

      this.needsRerender = false;
    }
  }

  performIsosurfaceHitTest(mousePosition: [number, number]): THREE.Vector3 | null | undefined {
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
    // TODO: use active td camera
    raycaster.setFromCamera(mouse, this.cameras[OrthoViews.TDView][TDCameras.OrthographicCamera]);
    // The second parameter of intersectObjects is set to true to ensure that
    // the groups which contain the actual meshes are traversed.
    // @ts-ignore
    const intersectableObjects = isosurfacesRootGroup.children.filter((obj) => !obj.passive);
    const intersections = raycaster.intersectObjects(intersectableObjects, true);
    const hitObject = intersections.length > 0 ? intersections[0].object : null;

    // Check whether we are hitting the same object as before, since we can return early
    // in this case.
    if (hitObject === oldRaycasterHit) {
      return intersections.length > 0 ? intersections[0].point : null;
    }

    // Undo highlighting of old hit
    if (oldRaycasterHit != null && oldRaycasterHit.parent != null) {
      oldRaycasterHit.parent.children.forEach((meshPart) => {
        // @ts-ignore
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
        // @ts-ignore
        meshPart.material.emissive.setHSL(...hoveredColor);
      });
      // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
      Store.dispatch(updateTemporarySettingAction("hoveredSegmentId", hitObject.parent.cellId));
      return intersections[0].point;
    } else {
      Store.dispatch(updateTemporarySettingAction("hoveredSegmentId", 0));
      return null;
    }
  }

  bindToEvents() {
    this.storePropertyUnsubscribers = [
      listenToStoreProperty(
        (storeState) => storeState.userConfiguration.tdViewUseOrthographicCamera,
        (tdViewUseOrthographicCamera) => {
          this.tdViewUseOrthographicCamera = tdViewUseOrthographicCamera;
        },
        true,
      ),
    ];
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
    getSceneController().renderer.setSize(width, height);
    this.draw();
  };

  getCameras(): OrthoViewCameraMap {
    return this.cameras;
  }

  stop(): void {
    this.running = false;

    for (const camera of allCameras(this.cameras)) {
      getSceneController().scene.remove(camera);
    }

    window.removeEventListener("resize", this.resizeThrottled);
    this.storePropertyUnsubscribers.forEach((unsubscribeFunction) => unsubscribeFunction());
  }

  start(): void {
    this.running = true;
    this.resize();
    this.animate();
    window.addEventListener("resize", this.resizeThrottled);
  }
}

export default PlaneView;
