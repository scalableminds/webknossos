import app from "app";
import window from "libs/window";
import _ from "lodash";
import * as THREE from "three";
import TWEEN from "tween.js";
import type { OrthoViewMap, Viewport } from "viewer/constants";
import Constants, { ARBITRARY_CAM_DISTANCE, ArbitraryViewport, OrthoViews } from "viewer/constants";
import getSceneController, {
  getSceneControllerOrNull,
} from "viewer/controller/scene_controller_provider";
import type ArbitraryPlane from "viewer/geometries/arbitrary_plane";
import { getZoomedMatrix } from "viewer/model/accessors/flycam_accessor";
import { getInputCatcherRect } from "viewer/model/accessors/view_mode_accessor";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import Store from "viewer/store";
import {
  getGroundTruthLayoutRect,
  show3DViewportInArbitrary,
} from "viewer/view/layouting/default_layout_configs";
import { clearCanvas, renderToTexture, setupRenderArea } from "viewer/view/rendering_utils";

type GeometryLike = {
  addToScene: (obj: THREE.Object3D) => void;
};

class ArbitraryView {
  cameras: OrthoViewMap<THREE.OrthographicCamera>;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'plane' has no initializer and is not def... Remove this comment to see the full error message
  plane: ArbitraryPlane;
  animate: () => void;
  setClippingDistance: (value: number) => void;
  needsRerender: boolean;
  additionalInfo: string = "";
  isRunning: boolean = false;
  animationRequestId: number | null | undefined = null;
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'null' is not assignable to type 'Perspective... Remove this comment to see the full error message
  camera: THREE.PerspectiveCamera = null;
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'null' is not assignable to type 'Orthographi... Remove this comment to see the full error message
  tdCamera: THREE.OrthographicCamera = null;
  geometries: Array<GeometryLike> = [];
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'group' has no initializer and is not def... Remove this comment to see the full error message
  group: THREE.Object3D;
  cameraPosition: Array<number>;
  unsubscribeFunctions: Array<() => void> = [];
  isOrthoPlaneView = false;

  constructor() {
    this.animate = this.animateImpl.bind(this);
    this.setClippingDistance = this.setClippingDistanceImpl.bind(this);

    const { scene } = getSceneController();
    // Initialize main THREE.js components
    this.camera = new THREE.PerspectiveCamera(45, 1, 50, 1000);
    // This name can be used to retrieve the camera from the scene
    this.camera.name = ArbitraryViewport;
    this.camera.matrixAutoUpdate = false;
    scene.add(this.camera);
    const tdCamera = new THREE.OrthographicCamera(0, 0, 0, 0);
    tdCamera.position.copy(new THREE.Vector3(10, 10, -10));
    tdCamera.up = new THREE.Vector3(0, 0, -1);
    tdCamera.matrixAutoUpdate = true;
    this.tdCamera = tdCamera;
    const dummyCamera = new THREE.OrthographicCamera(45, 1, 50, 1000);
    this.cameras = {
      TDView: tdCamera,
      PLANE_XY: dummyCamera,
      PLANE_YZ: dummyCamera,
      PLANE_XZ: dummyCamera,
    };
    this.cameraPosition = [0, 0, ARBITRARY_CAM_DISTANCE];
    this.needsRerender = true;
  }

  getCameras(): OrthoViewMap<THREE.OrthographicCamera> {
    return this.cameras;
  }

  start(): void {
    if (!this.isRunning) {
      this.isRunning = true;

      this.unsubscribeFunctions.push(
        app.vent.on("rerender", () => {
          this.needsRerender = true;
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

      this.group = new THREE.Object3D();
      this.group.add(this.camera);
      getSceneController().rootGroup.add(this.group);
      this.resizeImpl();
      // start the rendering loop
      this.animationRequestId = window.requestAnimationFrame(this.animate);
      // Dont forget to handle window resizing!
      window.addEventListener("resize", this.resizeThrottled);
      this.unsubscribeFunctions.push(
        listenToStoreProperty(
          (storeState) => storeState.uiInformation.navbarHeight,
          () => this.resizeThrottled(),
          true,
        ),
      );
    }
  }

  stop(): void {
    if (this.isRunning) {
      this.isRunning = false;

      if (this.animationRequestId != null) {
        window.cancelAnimationFrame(this.animationRequestId);
        this.animationRequestId = null;
      }

      // SceneController will already be null, if the user left the dataset view
      // because componentWillUnmount will trigger earlier for outer components and
      // later for inner components. The outer component TracingLayoutView is responsible
      // for the destroy call which already happened when the stop method here is called.
      getSceneControllerOrNull()?.rootGroup.remove(this.group);
      window.removeEventListener("resize", this.resizeThrottled);

      for (const fn of this.unsubscribeFunctions) {
        fn();
      }
      this.unsubscribeFunctions = [];
    }
  }

  animateImpl(): void {
    if (!this.isRunning) {
      return;
    }
    this.renderFunction();
    this.animationRequestId = window.requestAnimationFrame(this.animate);
  }

  renderFunction() {
    this.animationRequestId = null;
    TWEEN.update();

    if (this.needsRerender) {
      const { camera, geometries } = this;
      const { renderer, scene } = getSceneController();

      for (const geometry of geometries) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'update' does not exist on type 'Geometry... Remove this comment to see the full error message
        if (geometry.update != null) {
          // @ts-expect-error ts-migrate(2339) FIXME: Property 'update' does not exist on type 'Geometry... Remove this comment to see the full error message
          geometry.update();
        }
      }

      const m = getZoomedMatrix(Store.getState().flycam);
      // biome-ignore format: don't format array
      camera.matrix.set(
        m[0], m[4], m[8], m[12],
        m[1], m[5], m[9], m[13],
        m[2], m[6], m[10], m[14],
        m[3], m[7], m[11], m[15],
      );
      camera.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      // @ts-expect-error ts-migrate(2556) FIXME: Expected 3 arguments, but got 0 or more.
      camera.matrix.multiply(new THREE.Matrix4().makeTranslation(...this.cameraPosition));
      camera.matrixWorldNeedsUpdate = true;
      clearCanvas(renderer);
      const storeState = Store.getState();

      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'viewport' implicitly has an 'any' type.
      const renderViewport = (viewport, _camera) => {
        const { left, top, width, height } = getInputCatcherRect(storeState, viewport);

        if (width > 0 && height > 0) {
          setupRenderArea(renderer, left, top, width, height, 0xffffff);
          renderer.render(scene, _camera);
        }
      };

      if (this.plane.meshes.debuggerPlane != null) {
        this.plane.meshes.debuggerPlane.visible = false;
      }

      renderViewport(ArbitraryViewport, camera);

      if (show3DViewportInArbitrary) {
        if (this.plane.meshes.debuggerPlane != null) {
          this.plane.meshes.debuggerPlane.visible = true;
        }

        renderViewport(OrthoViews.TDView, this.tdCamera);
      }

      this.needsRerender = false;
    }
  }

  draw(): void {
    this.needsRerender = true;
  }

  getRenderedBucketsDebug = () => {
    // This method can be used to determine which buckets were used during rendering.
    // It returns an array with bucket indices which were used by the fragment shader.
    // Code similar to the following will render buckets wireframes in red, if there were
    // passed to the GPU but were not used.
    // It can be used within the orthogonal bucket picker for example.
    //
    // import * as Utils from "libs/utils";
    // import type { Vector4 } from "viewer/constants";
    // const makeBucketId = ([x, y, z], logZoomStep) => [x, y, z, logZoomStep].join(",");
    // const unpackBucketId = (str): Vector4 =>
    //   str
    //     .split(",")
    //     .map(el => parseInt(el))
    //     .map((el, idx) => (idx < 3 ? el : 0));
    // function diff(traversedBuckets, lastRenderedBuckets) {
    //     const bucketDiff = Utils.diffArrays(traversedBuckets.map(makeBucketId), lastRenderedBuckets.map(makeBucketId));
    //
    //     bucketDiff.onlyA.forEach(bucketAddress => {
    //       const bucket = cube.getOrCreateBucket(unpackBucketId(bucketAddress));
    //       if (bucket.type !== "null") bucket.setVisualizationColor(0xff0000);
    //     });
    //     bucketDiff.both.forEach(bucketAddress => {
    //       const bucket = cube.getOrCreateBucket(unpackBucketId(bucketAddress));
    //       if (bucket.type !== "null") bucket.setVisualizationColor(0x00ff00);
    //     });
    // }
    // diff(traversedBuckets, getRenderedBucketsDebug());
    this.plane.materialFactory.uniforms.renderBucketIndices.value = true;
    const buffer = renderToTexture(ArbitraryViewport);
    this.plane.materialFactory.uniforms.renderBucketIndices.value = false;
    let index = 0;
    const usedBucketSet = new Set();
    const usedBuckets = [];

    while (index < buffer.length) {
      const bucketAddress = buffer.subarray(index, index + 4);
      index += 4;
      const id = bucketAddress.join(",");

      if (!usedBucketSet.has(id)) {
        usedBucketSet.add(id);
        usedBuckets.push(bucketAddress);
      }
    }

    return usedBuckets;
  };

  addGeometry(geometry: GeometryLike): void {
    // Adds a new Three.js geometry to the scene.
    // This provides the public interface to the GeometryFactory.
    this.geometries.push(geometry);
    geometry.addToScene(this.group);
  }

  setArbitraryPlane(p: ArbitraryPlane) {
    this.plane = p;
  }

  resizeImpl = (): void => {
    const sceneController = getSceneControllerOrNull();
    if (sceneController == null) {
      // Since resizeImpl is called in a throttled manner, the
      // scene controller might have already been destroyed.
      return;
    }
    // Call this after the canvas was resized to fix the viewport
    const { width, height } = getGroundTruthLayoutRect();
    sceneController.renderer.setSize(width, height);
    this.draw();
  };

  // throttle resize to avoid annoying flickering
  resizeThrottled = _.throttle(this.resizeImpl, Constants.RESIZE_THROTTLE_TIME);

  setClippingDistanceImpl(value: number): void {
    this.camera.near = ARBITRARY_CAM_DISTANCE - value;
    this.camera.updateProjectionMatrix();
  }

  setAdditionalInfo(info: string): void {
    this.additionalInfo = info;
  }

  getCameraForPlane(_plane: Viewport) {
    return this.camera;
  }
}

export default ArbitraryView;
