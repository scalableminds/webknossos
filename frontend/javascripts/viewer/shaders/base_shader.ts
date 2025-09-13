import type TPS3D from "libs/thin_plate_spline";
import { type DataTexture, GLSL3, RawShaderMaterial } from "three";
import type { Uniforms } from "viewer/geometries/materials/plane_material_factory";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import shaderEditor from "viewer/model/helpers/shader_editor";

/**
 * Base class for shader materials that provides common functionality
 * for material creation, uniform management, and lifecycle handling.
 */
export abstract class BaseShader {
  material: RawShaderMaterial;
  uniforms: Uniforms = {};
  scaledTps: TPS3D | null = null;
  oldVertexShaderCode: string | null = null;
  storePropertyUnsubscribers: Array<() => void> = [];

  constructor(protected materialId: string) {
    this.setupBaseUniforms();
    this.setupCustomUniforms();
    this.material = this.createMaterial();
    shaderEditor.addMaterial(materialId, this.material);
  }

  protected createMaterial(): RawShaderMaterial {
    return new RawShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      glslVersion: GLSL3,
    });
  }

  protected setupBaseUniforms(): void {
    // Override in subclasses to set up base uniforms
  }

  protected abstract setupCustomUniforms(): void;

  protected addStoreListener<T>(
    selector: (state: any) => T,
    callback: (value: T) => void,
    immediate = false,
  ): void {
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(selector, callback, immediate),
    );
  }

  abstract getVertexShader(): string;
  abstract getFragmentShader(): string;

  getMaterial(): RawShaderMaterial {
    return this.material;
  }

  recomputeVertexShader(): void {
    const newVertexShaderCode = this.getVertexShader();

    // Comparing to this.material.vertexShader does not work. The code seems
    // to be modified by a third party.
    if (this.oldVertexShaderCode != null && this.oldVertexShaderCode === newVertexShaderCode) {
      return;
    }

    this.oldVertexShaderCode = newVertexShaderCode;
    this.material.vertexShader = newVertexShaderCode;
    this.material.needsUpdate = true;
  }

  destroy(): void {
    for (const fn of this.storePropertyUnsubscribers) {
      fn();
    }
    this.storePropertyUnsubscribers = [];

    // Avoid memory leaks on tear down.
    for (const key of Object.keys(this.uniforms)) {
      this.uniforms[key].value = null;
    }
  }
}