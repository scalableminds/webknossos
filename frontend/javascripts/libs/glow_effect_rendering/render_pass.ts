import type * as THREE from "three";
import { Color } from "three";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";

class RenderPass extends Pass {
  scene!: THREE.Scene;
  camera!: THREE.Camera;
  overrideMaterial: THREE.Material | null;
  isRenderPass: boolean = true;

  clearColor: Color | null;
  clearAlpha: number | null;
  _oldClearColor: Color;

  clearDepth: boolean;

  constructor(
    overrideMaterial?: THREE.Material | null,
    clearColor?: Color | null,
    clearAlpha?: number | null,
  ) {
    super();

    this.overrideMaterial = overrideMaterial || null;

    this.clearColor = clearColor || null;
    this.clearAlpha = clearAlpha || null;

    this.clear = true;
    this.clearDepth = false;
    this.needsSwap = false;
    this._oldClearColor = new Color();
  }

  setSceneAndCamera(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
  }

  render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget /*, deltaTime, maskActive */,
  ) {
    if (this.scene == null || this.camera == null) {
      throw new Error("RenderPass requires scene and camera to be set");
    }
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    let oldClearAlpha, oldOverrideMaterial;

    if (this.overrideMaterial !== null) {
      oldOverrideMaterial = this.scene.overrideMaterial;

      this.scene.overrideMaterial = this.overrideMaterial;
    }

    if (this.clearColor !== null) {
      renderer.getClearColor(this._oldClearColor);
      renderer.setClearColor(this.clearColor, renderer.getClearAlpha());
    }

    if (this.clearAlpha !== null) {
      oldClearAlpha = renderer.getClearAlpha();
      renderer.setClearAlpha(this.clearAlpha);
    }

    if (this.clearDepth) {
      renderer.clearDepth();
    }

    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);

    if (this.clear === true) {
      // TODO: Avoid using autoClear properties, see https://github.com/mrdoob/three.js/pull/15571#issuecomment-465669600
      renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
    }

    renderer.render(this.scene, this.camera);

    // restore

    if (this.clearColor !== null) {
      renderer.setClearColor(this._oldClearColor);
    }

    if (this.clearAlpha !== null && oldClearAlpha !== undefined) {
      renderer.setClearAlpha(oldClearAlpha);
    }

    if (this.overrideMaterial !== null && oldOverrideMaterial !== undefined) {
      this.scene.overrideMaterial = oldOverrideMaterial;
    }

    renderer.autoClear = oldAutoClear;
  }
}

export { RenderPass };
