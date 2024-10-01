import * as THREE from "three";
import { Clock, HalfFloatType, NoBlending, Vector2, WebGLRenderTarget } from "three";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass";
import type { Pass } from "three/examples/jsm/postprocessing/Pass";
import { MaskPass } from "three/examples/jsm/postprocessing/MaskPass";
import { ClearMaskPass } from "three/examples/jsm/postprocessing/MaskPass";
import type { RenderPass } from "./render_pass";

// Modified EffectComposer from the official three.js examples.
// Our changes support passing camera and scene in render method.

export default class RenderingEffectComposer {
  renderer: THREE.WebGLRenderer;
  renderTarget1: THREE.WebGLRenderTarget;
  renderTarget2: THREE.WebGLRenderTarget;
  writeBuffer: THREE.WebGLRenderTarget;
  readBuffer: THREE.WebGLRenderTarget;
  passes: Pass[];
  copyPass: ShaderPass;
  clock: Clock;
  renderToScreen: boolean;
  _pixelRatio: number;
  _width: number;
  _height: number;
  rendererViewport: THREE.Vector4;

  constructor(renderer: THREE.WebGLRenderer, renderTarget?: THREE.WebGLRenderTarget) {
    this.renderer = renderer;

    this._pixelRatio = renderer.getPixelRatio();

    if (renderTarget === undefined) {
      const size = renderer.getSize(new Vector2());
      this._width = size.width;
      this._height = size.height;

      renderTarget = new WebGLRenderTarget(
        this._width * this._pixelRatio,
        this._height * this._pixelRatio,
        { type: HalfFloatType },
      );
      renderTarget.texture.name = "EffectComposer.rt1";
    } else {
      this._width = renderTarget.width;
      this._height = renderTarget.height;
    }

    this.renderTarget1 = renderTarget;
    this.renderTarget2 = renderTarget.clone();
    this.renderTarget2.texture.name = "EffectComposer.rt2";

    this.writeBuffer = this.renderTarget1;
    this.readBuffer = this.renderTarget2;

    this.renderToScreen = true;

    this.passes = [];

    this.copyPass = new ShaderPass(CopyShader);
    this.copyPass.material.blending = NoBlending;
    this.rendererViewport = new THREE.Vector4();

    this.clock = new Clock();
  }

  swapBuffers() {
    const tmp = this.readBuffer;
    this.readBuffer = this.writeBuffer;
    this.writeBuffer = tmp;
  }

  addPass(pass: Pass) {
    this.passes.push(pass);
    pass.setSize(this._width * this._pixelRatio, this._height * this._pixelRatio);
  }

  insertPass(pass: Pass, index: number) {
    this.passes.splice(index, 0, pass);
    pass.setSize(this._width * this._pixelRatio, this._height * this._pixelRatio);
  }

  removePass(pass: Pass) {
    const index = this.passes.indexOf(pass);

    if (index !== -1) {
      this.passes.splice(index, 1);
    }
  }

  isLastEnabledPass(passIndex: number) {
    for (let i = passIndex + 1; i < this.passes.length; i++) {
      if (this.passes[i].enabled) {
        return false;
      }
    }

    return true;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, deltaTime?: number) {
    // deltaTime value is in seconds

    if (deltaTime === undefined) {
      deltaTime = this.clock.getDelta();
    }

    const currentRenderTarget = this.renderer.getRenderTarget();
    debugger;
    this.rendererViewport = this.renderer.getViewport(new THREE.Vector4());
    //this.writeBuffer.setSize(this.rendererViewport.z, this.rendererViewport.w);
    //this.readBuffer.setSize(this.rendererViewport.z, this.rendererViewport.w);

    for (let i = 0, il = this.passes.length; i < il; i++) {
      const pass = this.passes[i];

      if (pass.enabled === false) continue;

      pass.renderToScreen = this.renderToScreen && this.isLastEnabledPass(i);
      if ("isRenderPass" in pass && pass.isRenderPass) {
        (pass as RenderPass).setSceneAndCamera(scene, camera);
      }
      pass.render(this.renderer, this.writeBuffer, this.readBuffer, deltaTime, false);

      if (pass.needsSwap) {
        this.swapBuffers();
      }
    }

    this.renderer.setRenderTarget(currentRenderTarget);
  }

  reset(renderTarget: THREE.WebGLRenderTarget) {
    if (renderTarget === undefined) {
      const size = this.renderer.getSize(new Vector2());
      this._pixelRatio = this.renderer.getPixelRatio();
      this._width = size.width;
      this._height = size.height;

      renderTarget = this.renderTarget1.clone();
      renderTarget.setSize(this._width * this._pixelRatio, this._height * this._pixelRatio);
    }

    this.renderTarget1.dispose();
    this.renderTarget2.dispose();
    this.renderTarget1 = renderTarget;
    this.renderTarget2 = renderTarget.clone();

    this.writeBuffer = this.renderTarget1;
    this.readBuffer = this.renderTarget2;
  }

  setSize(width: number, height: number) {
    this._width = width;
    this._height = height;

    const effectiveWidth = this._width * this._pixelRatio;
    const effectiveHeight = this._height * this._pixelRatio;

    this.renderTarget1.setSize(effectiveWidth, effectiveHeight);
    this.renderTarget2.setSize(effectiveWidth, effectiveHeight);

    for (let i = 0; i < this.passes.length; i++) {
      this.passes[i].setSize(effectiveWidth, effectiveHeight);
    }
  }

  setPixelRatio(pixelRatio: number) {
    this._pixelRatio = pixelRatio;

    this.setSize(this._width, this._height);
  }

  dispose() {
    this.renderTarget1.dispose();
    this.renderTarget2.dispose();

    this.copyPass.dispose();
  }
}
