// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'back... Remove this comment to see the full error message
import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'twee... Remove this comment to see the full error message
import TWEEN from "tween.js";
import _ from "lodash";
import {
  getGroundTruthLayoutRect,
  show3DViewportInArbitrary,
} from "oxalis/view/layouting/default_layout_configs";
import { getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import { getZoomedMatrix } from "oxalis/model/accessors/flycam_accessor";
import type ArbitraryPlane from "oxalis/geometries/arbitrary_plane";
import type { OrthoViewCameraMap } from "oxalis/constants";
import Constants, {
  ArbitraryViewport,
  OrthoViews,
  AnyCamera,
  TDCameras,
  TDCamerasType,
} from "oxalis/constants";
import Store from "oxalis/store";
import app from "app";
import getSceneController from "oxalis/controller/scene_controller_provider";
import window from "libs/window";
import { clearCanvas, setupRenderArea, renderToTexture } from "oxalis/view/rendering_utils";
import { forBothTdCameras } from "oxalis/controller/camera_controller";

type GeometryLike = {
  addToScene: (obj: THREE.Object3D) => void;
};

class ArbitraryView {
  // Copied form backbone events (TODO: handle this better)
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'trigger' has no initializer and is not d... Remove this comment to see the full error message
  trigger: (...args: Array<any>) => any;
  cameras: OrthoViewCameraMap;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'plane' has no initializer and is not def... Remove this comment to see the full error message
  plane: ArbitraryPlane;
  animate: () => void;
  setClippingDistance: (value: number) => void;
  needsRerender: boolean;
  additionalInfo: string = "";
  isRunning: boolean = false;
  animationRequestId: number | null | undefined = null;
  camDistance: number;
  tdCameras: TDCamerasType;
  camera: THREE.PerspectiveCamera;
  geometries: Array<GeometryLike> = [];
  group: THREE.Object3D;
  cameraPosition: Array<number>;

  constructor() {
    this.animate = this.animateImpl.bind(this);
    this.setClippingDistance = this.setClippingDistanceImpl.bind(this);

    _.extend(this, BackboneEvents);

    const { scene } = getSceneController();
    // camDistance has to be calculated such that with cam
    // angle 45°, the plane of width Constants.VIEWPORT_WIDTH fits exactly in the
    // viewport.
    this.camDistance = Constants.VIEWPORT_WIDTH / 2 / Math.tan(((Math.PI / 180) * 45) / 2);
    // Initialize main THREE.js components
    this.camera = new THREE.PerspectiveCamera(45, 1, 50, 1000);
    // This name can be used to retrieve the camera from the scene
    this.camera.name = ArbitraryViewport;
    this.camera.matrixAutoUpdate = false;
    scene.add(this.camera);
    this.group = new THREE.Object3D();
    const orthoTDCamera = new THREE.OrthographicCamera(0, 0, 0, 0);
    const perspectiveTDCamera = new THREE.PerspectiveCamera(45, 1, 50, 1000);

    this.tdCameras = {
      [TDCameras.PerspectiveCamera]: perspectiveTDCamera,
      [TDCameras.OrthographicCamera]: orthoTDCamera,
    };
    forBothTdCameras((camera: AnyCamera) => {
      camera.position.copy(new THREE.Vector3(10, 10, -10));
      camera.up = new THREE.Vector3(0, 0, -1);
      camera.matrixAutoUpdate = true;
    }, this.tdCameras);
    const dummyCamera = new THREE.OrthographicCamera(0, 0, 0, 0);
    this.cameras = {
      TDView: this.tdCameras,
      PLANE_XY: dummyCamera,
      PLANE_YZ: dummyCamera,
      PLANE_XZ: dummyCamera,
    };
    this.cameraPosition = [0, 0, this.camDistance];
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

  getCameras(): OrthoViewCameraMap {
    return this.cameras;
  }

  start(): void {
    if (!this.isRunning) {
      this.isRunning = true;
      this.group = new THREE.Object3D();
      this.group.add(this.camera);
      getSceneController().rootGroup.add(this.group);
      this.resizeImpl();
      // start the rendering loop
      this.animationRequestId = window.requestAnimationFrame(this.animate);
      // Dont forget to handle window resizing!
      window.addEventListener("resize", this.resizeThrottled);
    }
  }

  stop(): void {
    if (this.isRunning) {
      this.isRunning = false;

      if (this.animationRequestId != null) {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'cancelAnimationFrame' does not exist on ... Remove this comment to see the full error message
        window.cancelAnimationFrame(this.animationRequestId);
        this.animationRequestId = null;
      }

      getSceneController().rootGroup.remove(this.group);
      window.removeEventListener("resize", this.resizeThrottled);
    }
  }

  animateImpl(): void {
    this.animationRequestId = null;

    if (!this.isRunning) {
      return;
    }

    TWEEN.update();

    // @ts-expect-error ts-migrate(2339) FIXME: Property 'needsRerender' does not exist on type '(... Remove this comment to see the full error message
    if (this.needsRerender || window.needsRerender) {
      this.trigger("render");
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
      camera.matrix.set(
        m[0],
        m[4],
        m[8],
        m[12],
        m[1],
        m[5],
        m[9],
        m[13],
        m[2],
        m[6],
        m[10],
        m[14],
        m[3],
        m[7],
        m[11],
        m[15],
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
        if (storeState.userConfiguration.tdViewUseOrthographicCamera) {
          renderViewport(OrthoViews.TDView, this.tdCameras[TDCameras.OrthographicCamera]);
        } else {
          renderViewport(OrthoViews.TDView, this.tdCameras[TDCameras.PerspectiveCamera]);
        }
      }

      this.needsRerender = false;
      // @ts-ignore
      window.needsRerender = false;
    }

    this.animationRequestId = window.requestAnimationFrame(this.animate);
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
    // import type { Vector4 } from "oxalis/constants";
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
      const bucketAddress = buffer
        .subarray(index, index + 4)
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'currentAnchorPoint' does not exist on ty... Remove this comment to see the full error message
        .map((el, idx) => (idx < 3 ? window.currentAnchorPoint[idx] + el : el));
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
    // Call this after the canvas was resized to fix the viewport
    const { width, height } = getGroundTruthLayoutRect();
    getSceneController().renderer.setSize(width, height);
    this.draw();
  };

  // throttle resize to avoid annoying flickering
  resizeThrottled = _.throttle(this.resizeImpl, Constants.RESIZE_THROTTLE_TIME);

  setClippingDistanceImpl(value: number): void {
    this.camera.near = this.camDistance - value;
    this.camera.updateProjectionMatrix();
  }

  setAdditionalInfo(info: string): void {
    this.additionalInfo = info;
  }
}

export default ArbitraryView;
