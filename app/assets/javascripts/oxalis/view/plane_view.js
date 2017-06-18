/**
 * plane_view.js
 * @flow
 */
import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import TWEEN from "tween.js";
import * as THREE from "three";
import Store from "oxalis/store";
import Constants, { OrthoViews, OrthoViewValues, OrthoViewColors } from "oxalis/constants";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import type { OrthoViewType, OrthoViewMapType, Vector2 } from "oxalis/constants";
import Model from "oxalis/model";
import SceneController from "oxalis/controller/scene_controller";


class PlaneView {

  // Copied form backbone events (TODO: handle this better)
  trigger: Function;
  listenTo: Function;

  cameras: OrthoViewMapType<THREE.OrthographicCamera>;
  group: THREE.Object3D;

  running: boolean;
  needsRerender: boolean;
  curWidth: number;

  constructor() {
    _.extend(this, Backbone.Events);

    this.running = false;
    const { scene, renderer } = SceneController;

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

    // Because the voxel coordinates do not have a cube shape but are distorted,
    // we need to distort the entire scene to provide an illustration that is
    // proportional to the actual size in nm.
    // For some reason, all objects have to be put into a group object. Changing
    // scene.scale does not have an effect.
    this.group = new THREE.Object3D();
    this.group.add(SceneController.getRootNode());

    // The dimension(s) with the highest resolution will not be distorted
    this.group.scale.copy(new THREE.Vector3(...Store.getState().dataset.scale));
    // Add scene to the group, all Geometries are than added to group
    scene.add(this.group);

    scene.add(new THREE.AmbientLight(0x333333));
    let directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight.position.set(1, 1, -1).normalize();
    scene.add(directionalLight);
    directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
    directionalLight.position.set(-1, -1, -1).normalize();
    scene.add(directionalLight);

    // Attach the canvas to the container
    renderer.setSize((2 * this.curWidth) + 20, (2 * this.curWidth) + 20);

    this.needsRerender = true;
    app.vent.on("rerender", () => { this.needsRerender = true; });
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
    if (!this.running) { return; }

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

    this.trigger("renderCam", plane);
    renderer.render(scene, this.cameras[plane], renderTarget);
    renderer.readRenderTargetPixels(renderTarget, 0, 0, this.curWidth, this.curWidth, buffer);
    return buffer;
  }

  renderFunction(): void {
    // This is the main render function.
    // All 3D meshes and the trianglesplane are rendered here.

    TWEEN.update();

    // skip rendering if nothing has changed
    // This prevents you the GPU/CPU from constantly
    // working and keeps your lap cool
    // ATTENTION: this limits the FPS to 60 FPS (depending on the keypress update frequence)

    let modelChanged: boolean = false;
    for (const name of Object.keys(Model.binary)) {
      const binary = Model.binary[name];
      for (const plane of _.values(binary.planes)) {
        modelChanged = modelChanged || plane.hasChanged();
      }
    }

    if (this.needsRerender || modelChanged) {
      const { renderer, scene } = SceneController;

      this.trigger("render");

      const viewport: OrthoViewMapType<Vector2> = {
        [OrthoViews.PLANE_XY]: [0, this.curWidth + 20],
        [OrthoViews.PLANE_YZ]: [this.curWidth + 20, this.curWidth + 20],
        [OrthoViews.PLANE_XZ]: [0, 0],
        [OrthoViews.TDView]: [this.curWidth + 20, 0],
      };
      renderer.autoClear = true;

      const setupRenderArea = (x, y, width, color) => {
        renderer.setViewport(x, y, width, width);
        renderer.setScissor(x, y, width, width);
        renderer.setScissorTest(true);
        renderer.setClearColor(color, 1);
      };

      setupRenderArea(0, 0, renderer.domElement.width, 0xffffff);
      renderer.clear();

      for (const plane of OrthoViewValues) {
        this.trigger("renderCam", plane);
        setupRenderArea(
          viewport[plane][0],
          viewport[plane][1],
          this.curWidth,
          OrthoViewColors[plane],
        );
        renderer.render(scene, this.cameras[plane]);
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
    const viewportWidth = Math.round(Store.getState().userConfiguration.scale * Constants.VIEWPORT_WIDTH);
    const canvasWidth = viewportWidth * 2 + 20;
    this.curWidth = viewportWidth;

    SceneController.renderer.setSize(canvasWidth, canvasWidth);
    for (const plane of OrthoViewValues) {
      this.cameras[plane].aspect = canvasWidth / canvasWidth;
      this.cameras[plane].updateProjectionMatrix();
    }
    this.draw();
  };

  getCameras(): OrthoViewMapType<THREE.OrthographicCamera> {
    return this.cameras;
  }


  stop(): void {
    this.running = false;
  }


  start(): void {
    this.running = true;

    this.resize();
    this.animate();
  }
}

export default PlaneView;
