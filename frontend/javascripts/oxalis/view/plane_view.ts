import app from "app";
import VisibilityAwareRaycaster from "libs/visibility_aware_raycaster";
import window from "libs/window";
import _ from "lodash";
import type { OrthoViewMap, Vector2, Vector3, Viewport } from "oxalis/constants";
import Constants, { OrthoViewColors, OrthoViewValues, OrthoViews } from "oxalis/constants";
import type { PositionToSegmentId } from "oxalis/controller/mesh_helpers";
import getSceneController, {
  getSceneControllerOrNull,
} from "oxalis/controller/scene_controller_provider";
import type { MeshSceneNode, SceneGroupForMeshes } from "oxalis/controller/segment_mesh_controller";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import { getActiveSegmentationTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { updateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import Store from "oxalis/store";
import { getGroundTruthLayoutRect } from "oxalis/view/layouting/default_layout_configs";
import { clearCanvas, setupRenderArea } from "oxalis/view/rendering_utils";
import * as THREE from "three";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'twee... Remove this comment to see the full error message
import TWEEN from "tween.js";

const LIGHT_INTENSITY = 10;

type RaycasterHit = {
  node: MeshSceneNode;
  indexRange: Vector2 | null;
  unmappedSegmentId: number | null;
  point: Vector3;
} | null;

const createDirLight = (
  position: Vector3,
  target: Vector3,
  intensity: number,
  camera: THREE.OrthographicCamera,
) => {
  // @ts-ignore
  const dirLight = new THREE.DirectionalLight(0x888888, intensity);
  dirLight.position.set(...position);
  camera.add(dirLight);
  camera.add(dirLight.target);
  dirLight.target.position.set(...target);

  return dirLight;
};

const raycaster = new VisibilityAwareRaycaster();
raycaster.firstHitOnly = true;
const MESH_HOVER_THROTTLING_DELAY = 50;

let oldRaycasterHit: RaycasterHit = null;

class PlaneView {
  cameras: OrthoViewMap<THREE.OrthographicCamera>;
  running: boolean;
  needsRerender: boolean;
  unsubscribeFunctions: Array<() => void> = [];

  constructor() {
    this.running = false;
    const { scene } = getSceneController();
    // Initialize main THREE.js components
    const cameras = {} as OrthoViewMap<THREE.OrthographicCamera>;

    for (const plane of OrthoViewValues) {
      // Let's set up cameras
      // No need to set any properties, because the cameras controller will deal with that
      cameras[plane] = new THREE.OrthographicCamera(0, 0, 0, 0);
      // This name can be used to retrieve the camera from the scene
      cameras[plane].name = plane;
      scene.add(cameras[plane]);
    }
    this.cameras = cameras;

    createDirLight([10, 10, 10], [0, 0, 10], LIGHT_INTENSITY, this.cameras[OrthoViews.TDView]);
    createDirLight([-10, 10, 10], [0, 0, 10], LIGHT_INTENSITY, this.cameras[OrthoViews.TDView]);
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
    // ATTENTION: this limits the FPS to 60 FPS (depending on the keypress update frequency)
    if (forceRender || this.needsRerender) {
      const { renderer, scene } = SceneController;
      SceneController.update();
      const storeState = Store.getState();
      const viewport = {
        [OrthoViews.PLANE_XY]: getInputCatcherRect(storeState, "PLANE_XY"),
        [OrthoViews.PLANE_YZ]: getInputCatcherRect(storeState, "PLANE_YZ"),
        [OrthoViews.PLANE_XZ]: getInputCatcherRect(storeState, "PLANE_XZ"),
        [OrthoViews.TDView]: getInputCatcherRect(storeState, "TDView"),
      };
      renderer.autoClear = true;
      clearCanvas(renderer);

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

  performMeshHitTest = _.throttle((mousePosition: [number, number]): RaycasterHit => {
    const storeState = Store.getState();
    const SceneController = getSceneController();
    const { segmentMeshController } = SceneController;
    const { meshesLODRootGroup } = segmentMeshController;
    const tdViewport = getInputCatcherRect(storeState, "TDView");
    const { hoveredSegmentId } = storeState.temporaryConfiguration;

    // Outside of the 3D viewport, we don't do mesh hit tests
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
    raycaster.setFromCamera(mouse, this.cameras[OrthoViews.TDView]);
    const intersectableObjects = meshesLODRootGroup.children;
    // The second parameter of intersectObjects is set to true to ensure that
    // the groups which contain the actual meshes are traversed.
    const intersections = raycaster.intersectObjects(intersectableObjects, true);
    const face = intersections.length > 0 ? intersections[0].face : null;
    const hitObject = intersections.length > 0 ? (intersections[0].object as MeshSceneNode) : null;
    let unmappedSegmentId = null;
    let indexRange = null;

    if (hitObject && face) {
      if ("positionToSegmentId" in hitObject.geometry) {
        const positionToSegmentId = hitObject.geometry.positionToSegmentId as PositionToSegmentId;
        unmappedSegmentId = positionToSegmentId.getUnmappedSegmentIdForPosition(face.a);
        indexRange = positionToSegmentId.getRangeForUnmappedSegmentId(unmappedSegmentId);
      }
    }

    // Check whether we are hitting the same object as before, since we can return early
    // in this case.
    if (storeState.uiInformation.activeTool === "PROOFREAD") {
      if (hitObject == null && oldRaycasterHit == null) {
        return null;
      }
      if (unmappedSegmentId != null && unmappedSegmentId === oldRaycasterHit?.unmappedSegmentId) {
        return oldRaycasterHit;
      }
    } else {
      // In proofreading, there is no highlighting of parts of the meshes.
      // If the parent group is identical, we can reuse the old hit object.
      if (hitObject?.parent === oldRaycasterHit?.node.parent) {
        return oldRaycasterHit;
      }
    }

    // Undo highlighting of old hit
    this.clearLastMeshHitTest();

    oldRaycasterHit =
      hitObject != null
        ? {
            node: hitObject,
            indexRange,
            unmappedSegmentId,
            point: intersections[0].point.toArray(),
          }
        : null;

    // Highlight new hit
    if (hitObject?.parent != null) {
      segmentMeshController.updateMeshAppearance(hitObject, true, undefined, indexRange || "full");

      Store.dispatch(
        updateTemporarySettingAction(
          "hoveredSegmentId",
          (hitObject.parent as SceneGroupForMeshes).segmentId,
        ),
      );
      return oldRaycasterHit;
    } else {
      Store.dispatch(updateTemporarySettingAction("hoveredSegmentId", null));
      return null;
    }
  }, MESH_HOVER_THROTTLING_DELAY);

  clearLastMeshHitTest = () => {
    if (oldRaycasterHit?.node.parent != null) {
      const SceneController = getSceneController();
      const { segmentMeshController } = SceneController;
      segmentMeshController.updateMeshAppearance(oldRaycasterHit.node, false, undefined, null);
      oldRaycasterHit = null;
    }
  };

  draw(): void {
    app.vent.emit("rerender");
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

  getCameras(): OrthoViewMap<THREE.OrthographicCamera> {
    return this.cameras;
  }

  stop(): void {
    this.running = false;

    const sceneController = getSceneControllerOrNull();
    if (sceneController != null) {
      for (const plane of OrthoViewValues) {
        sceneController.scene.remove(this.cameras[plane]);
      }
    }

    window.removeEventListener("resize", this.resizeThrottled);

    for (const fn of this.unsubscribeFunctions) {
      fn();
    }
    this.unsubscribeFunctions = [];
  }

  start(): void {
    const SceneController = getSceneController();
    const { segmentMeshController } = SceneController;

    this.unsubscribeFunctions.push(
      app.vent.on("rerender", () => {
        this.needsRerender = true;
      }),
    );

    this.unsubscribeFunctions.push(
      // Only used for benchmarks (see WkDev)
      app.vent.on("forceImmediateRerender", () => {
        this.renderFunction(true);
      }),
    );

    this.unsubscribeFunctions.push(
      Store.subscribe(() => {
        // Render in the next frame after the change propagated everywhere
        window.requestAnimationFrame(() => {
          this.needsRerender = true;
        });
      }),
    );

    this.running = true;
    this.resize();
    this.animate();
    window.addEventListener("resize", this.resizeThrottled);
    this.unsubscribeFunctions.push(
      listenToStoreProperty(
        (storeState) => storeState.uiInformation.navbarHeight,
        () => this.resizeThrottled(),
        true,
      ),
    );
    this.unsubscribeFunctions.push(
      listenToStoreProperty(
        (storeState) => {
          const segmentationTracing = getActiveSegmentationTracing(storeState);
          if (segmentationTracing == null) {
            return null;
          }
          // If the proofreading tool is not active, pretend that
          // activeUnmappedSegmentId is null so that no super-voxel
          // is highlighted.
          return storeState.uiInformation.activeTool === "PROOFREAD"
            ? segmentationTracing.activeUnmappedSegmentId
            : null;
        },
        (activeUnmappedSegmentId) =>
          // Note that this code is responsible for highlighting the *active*
          // (not necessarily hovered) segment.
          segmentMeshController.highlightActiveUnmappedSegmentId(activeUnmappedSegmentId),
        true,
      ),
    );
  }

  getCameraForPlane(plane: Viewport) {
    if (plane === "arbitraryViewport") {
      throw new Error("Cannot access camera for arbitrary viewport.");
    }
    return this.getCameras()[plane];
  }
}

export default PlaneView;
