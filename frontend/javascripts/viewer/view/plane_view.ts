import { sendAnalyticsEvent } from "admin/rest_api";
import app from "app";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import VisibilityAwareRaycaster from "libs/visibility_aware_raycaster";
import window from "libs/window";
import throttle from "lodash-es/throttle";
import {
  type Camera,
  DirectionalLight,
  OrthographicCamera,
  PerspectiveCamera,
  Vector2 as ThreeVector2,
  Vector3 as ThreeVector3,
} from "three";
import TWEEN from "tween.js";
import type { OrthoViewMap, Vector2, Vector3, Viewport } from "viewer/constants";
import Constants, {
  OrthoViewColors,
  OrthoViews,
  OrthoViewValues,
  PerformanceMarkEnum,
} from "viewer/constants";
import type { VertexSegmentMapping } from "viewer/controller/mesh_helpers";
import { getWebGlAnalyticsInformation } from "viewer/controller/renderer";
import getSceneController, {
  getSceneControllerOrNull,
} from "viewer/controller/scene_controller_provider";
import type { MeshSceneNode, SceneGroupForMeshes } from "viewer/controller/segment_mesh_controller";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { getInputCatcherRect } from "viewer/model/accessors/view_mode_accessor";
import { getActiveSegmentationTracing } from "viewer/model/accessors/volumetracing_accessor";
import { uiReadyAction } from "viewer/model/actions/actions";
import { updateTemporarySettingAction } from "viewer/model/actions/settings_actions";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import Store from "viewer/store";
import { getGroundTruthLayoutRect } from "viewer/view/layouting/default_layout_configs";
import { clearCanvas, setupRenderArea } from "viewer/view/rendering_utils";

const LIGHT_INTENSITY = 10;

type RaycasterHit = {
  node: MeshSceneNode;
  indexRange: Vector2 | null;
  unmappedSegmentId: number | null;
  point: Vector3;
} | null;

const createDirLight = (position: Vector3, target: Vector3, intensity: number, camera: Camera) => {
  const dirLight = new DirectionalLight(0x888888, intensity);
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
  cameras: OrthoViewMap<OrthographicCamera | PerspectiveCamera>;
  isRunning: boolean = false;
  needsRerender: boolean;
  unsubscribeFunctions: Array<() => void> = [];

  constructor() {
    const { scene } = getSceneController();
    // Initialize main js components
    const cameras = {} as OrthoViewMap<OrthographicCamera | PerspectiveCamera>;

    for (const plane of OrthoViewValues) {
      // Let's set up cameras
      // No need to set any properties, because the cameras controller will deal with that
      cameras[plane] =
        plane === OrthoViews.TDView
          ? new PerspectiveCamera(45, 1, 0.1, 1000)
          : new OrthographicCamera(0, 0, 0, 0);
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
    this.cameras[OrthoViews.TDView].position.copy(new ThreeVector3(10, 10, -10));
    this.cameras[OrthoViews.PLANE_XY].up = new ThreeVector3(0, -1, 0);
    this.cameras[OrthoViews.PLANE_YZ].up = new ThreeVector3(0, -1, 0);
    this.cameras[OrthoViews.PLANE_XZ].up = new ThreeVector3(0, 0, -1);
    this.cameras[OrthoViews.TDView].up = new ThreeVector3(0, 0, -1);

    for (const plane of OrthoViewValues) {
      this.cameras[plane].lookAt(new ThreeVector3(0, 0, 0));
    }

    this.needsRerender = true;
  }

  animate(): void {
    if (!this.isRunning) {
      return;
    }

    this.renderFunction();
    window.requestAnimationFrame(() => this.animate());
  }

  renderFunction(forceRender: boolean = false): void {
    // This is the main render function.
    // All 3D meshes and the trianglesplane are rendered here.
    TWEEN.update();
    const sceneController = getSceneController();

    // skip rendering if nothing has changed
    // This prevents the GPU/CPU from constantly
    // working and keeps your lap cool
    // ATTENTION: this limits the FPS to 60 FPS (depending on the keypress update frequency)
    if (forceRender || this.needsRerender) {
      const { renderer, scene } = sceneController;
      sceneController.update();
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
        sceneController.updateSceneForCam(plane);
        const { left, top, width, height } = viewport[plane];

        if (width > 0 && height > 0) {
          setupRenderArea(renderer, left, top, width, height, OrthoViewColors[plane]);
          renderer.render(scene, this.cameras[plane]);

          if (!window.measuredTimeToFirstRender) {
            this.measureTimeToFirstRender();
          }
        }
      }

      this.needsRerender = false;
    }
  }

  performMeshHitTest = throttle((mousePosition: [number, number]): RaycasterHit => {
    const storeState = Store.getState();
    const sceneController = getSceneController();
    const { segmentMeshController } = sceneController;
    const { meshesLayerLODRootGroup } = segmentMeshController;
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
    const mouse = new ThreeVector2(
      (mousePosition[0] / tdViewport.width) * 2 - 1,
      ((mousePosition[1] / tdViewport.height) * 2 - 1) * -1,
    );
    raycaster.setFromCamera(mouse, this.cameras[OrthoViews.TDView]);
    const intersectableObjects = meshesLayerLODRootGroup.children;
    // The second parameter of intersectObjects is set to true to ensure that
    // the groups which contain the actual meshes are traversed.
    const intersections = raycaster.intersectObjects(intersectableObjects, true);
    const face = intersections.length > 0 ? intersections[0].face : null;
    const hitObject = intersections.length > 0 ? (intersections[0].object as MeshSceneNode) : null;
    let unmappedSegmentId = null;
    let highlightEntry = null;

    if (hitObject && face) {
      if ("vertexSegmentMapping" in hitObject.geometry) {
        const vertexSegmentMapping = hitObject.geometry
          .vertexSegmentMapping as VertexSegmentMapping;
        unmappedSegmentId = vertexSegmentMapping.getUnmappedSegmentIdForPosition(face.a);
        const indexRange = vertexSegmentMapping.getRangeForUnmappedSegmentId(unmappedSegmentId);
        if (indexRange) {
          highlightEntry = { range: indexRange, color: undefined };
        }
      }
    }

    // Check whether we are hitting the same object as before, since we can return early
    // in this case.
    if (storeState.uiInformation.activeTool === AnnotationTool.PROOFREAD) {
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
            indexRange: highlightEntry?.range || null,
            unmappedSegmentId,
            point: intersections[0].point.toArray(),
          }
        : null;

    // Highlight new hit
    if (hitObject?.parent != null) {
      segmentMeshController.updateMeshAppearance(
        hitObject,
        true,
        undefined,
        undefined,
        highlightEntry ? [highlightEntry] : "full",
      );

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
      const sceneController = getSceneController();
      const { segmentMeshController } = sceneController;
      segmentMeshController.updateMeshAppearance(
        oldRaycasterHit.node,
        false,
        undefined,
        undefined,
        null,
      );
      oldRaycasterHit = null;
    }
  };

  draw(): void {
    app.vent.emit("rerender");
  }

  resizeThrottled = throttle((): void => {
    // throttle resize to avoid annoying flickering
    this.resize();
  }, Constants.RESIZE_THROTTLE_TIME);

  resize = (): void => {
    const { width, height } = getGroundTruthLayoutRect();
    const sceneController = getSceneControllerOrNull();
    // Resizes can be triggered by navbar height changes (e.g., maintenance banners).
    // When navigating back to the dashboard, a throttled resize may fire after
    // PlaneView/SceneController teardown, so sceneController can be null.
    if (sceneController != null) {
      sceneController.renderer.setSize(width, height);
      this.draw();
    }
  };

  getCameras(): OrthoViewMap<OrthographicCamera | PerspectiveCamera> {
    return this.cameras;
  }

  stop(): void {
    this.isRunning = false;

    const sceneController = getSceneControllerOrNull();
    if (sceneController != null) {
      for (const plane of OrthoViewValues) {
        sceneController.scene.remove(this.cameras[plane]);
      }
    }
    this.resizeThrottled.cancel();
    window.removeEventListener("resize", this.resizeThrottled);

    for (const fn of this.unsubscribeFunctions) {
      fn();
    }
    this.unsubscribeFunctions = [];
  }

  start(): void {
    const sceneController = getSceneController();
    const { segmentMeshController, renderer, scene } = sceneController;

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

    this.isRunning = true;
    this.resize();
    performance.mark(PerformanceMarkEnum.SHADER_COMPILE);
    // The shader is the same for all three viewports, so it doesn't matter which camera is used.
    renderer
      .compileAsync(scene, this.cameras[OrthoViews.PLANE_XY])
      .then(() => {
        // Counter-intuitively this is not the moment where the webgl program is fully compiled.
        // There is another stall once render or getProgramInfoLog is called, since not all work is done yet.
        // Only once that is done, the compilation process is fully finished, see `renderFunction`.
        this.animate();
        Store.dispatch(uiReadyAction());
      })
      .catch((error) => {
        // This code will not be hit if there are shader compilation errors. To react to those, see https://github.com/mrdoob/three.js/pull/25679
        Toast.error(`An unexpected error occurred while compiling the WebGL shaders: ${error}`);
        console.error(error);
        ErrorHandling.notify(error);
      });
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
          // activeUnmappedSegmentId is null so that no supervoxel
          // is highlighted.
          return storeState.uiInformation.activeTool === AnnotationTool.PROOFREAD
            ? segmentationTracing.activeUnmappedSegmentId
            : null;
        },
        (activeUnmappedSegmentId) =>
          // Note that this code is responsible for highlighting the *active*
          // (not necessarily hovered) segment.
          segmentMeshController.updateActiveUnmappedSegmentIdHighlighting(activeUnmappedSegmentId),
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
          return storeState.uiInformation.activeTool === AnnotationTool.PROOFREAD
            ? storeState.localSegmentationData[segmentationTracing.tracingId].minCutPartitions
            : null;
        },
        (minCutPartitions) =>
          segmentMeshController.updateMinCutPartitionHighlighting(minCutPartitions),
        true,
      ),
    );
  }

  measureTimeToFirstRender() {
    // We cannot use performance.getEntriesByType("navigation")[0].startTime, because the page might be loaded
    // much earlier. It is not reloaded when opening a dataset or annotation from the dashboard and also might
    // not be reloaded when navigating from the tracing view back to the dashboard.
    // Therefore, we use performance.mark in the router to mark the start time ourselves. The downside of that
    // is that the time for the intitial resource loading is not included, then.
    let timeToFirstRenderInMs, timeToCompileShaderInMs;
    if (performance.getEntriesByName(PerformanceMarkEnum.TRACING_VIEW_LOAD, "mark").length > 0) {
      timeToFirstRenderInMs = Math.round(
        performance.measure("tracing_view_load_duration", PerformanceMarkEnum.TRACING_VIEW_LOAD)
          .duration,
      );
      console.log(`Time to first render was ${timeToFirstRenderInMs} ms.`);
    }
    if (performance.getEntriesByName(PerformanceMarkEnum.SHADER_COMPILE, "mark").length > 0) {
      timeToCompileShaderInMs = Math.round(
        performance.measure("shader_compile_duration", PerformanceMarkEnum.SHADER_COMPILE).duration,
      );
      console.log(`Time to compile shaders was ${timeToCompileShaderInMs} ms.`);
    }

    sendAnalyticsEvent("time_to_first_render", {
      ...getWebGlAnalyticsInformation(Store.getState()),
      timeToFirstRenderInMs,
      timeToCompileShaderInMs,
    });
    window.measuredTimeToFirstRender = true;
  }

  getCameraForPlane(plane: Viewport) {
    if (plane === "arbitraryViewport") {
      throw new Error("Cannot access camera for arbitrary viewport.");
    }
    return this.getCameras()[plane];
  }
}

export default PlaneView;
