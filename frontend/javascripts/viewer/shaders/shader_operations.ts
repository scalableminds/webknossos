import _ from "lodash";
import type { ShaderMaterial } from "three";

/**
 * Common shader operations and utilities
 */
export class ShaderOperations {
  /**
   * Safely recomputes and updates shader code for a material
   */
  static updateShaderCode(
    material: ShaderMaterial,
    newFragmentShaderCode: string,
    newVertexShaderCode: string,
    oldFragmentShaderCode: string | null | undefined,
    oldVertexShaderCode: string | null | undefined,
    onUpdate?: () => void,
  ): { 
    fragmentShaderChanged: boolean;
    vertexShaderChanged: boolean;
    oldFragmentShaderCode: string;
    oldVertexShaderCode: string;
  } {
    let fragmentShaderChanged = false;
    let vertexShaderChanged = false;

    // Comparing to material.fragmentShader does not work. The code seems
    // to be modified by a third party.
    if (oldFragmentShaderCode == null || oldFragmentShaderCode !== newFragmentShaderCode) {
      material.fragmentShader = newFragmentShaderCode;
      fragmentShaderChanged = true;
    }

    if (oldVertexShaderCode == null || oldVertexShaderCode !== newVertexShaderCode) {
      material.vertexShader = newVertexShaderCode;
      vertexShaderChanged = true;
    }

    if (fragmentShaderChanged || vertexShaderChanged) {
      material.needsUpdate = true;
      onUpdate?.();
    }

    return {
      fragmentShaderChanged,
      vertexShaderChanged,
      oldFragmentShaderCode: newFragmentShaderCode,
      oldVertexShaderCode: newVertexShaderCode,
    };
  }

  /**
   * Throttled shader recomputation with state tracking
   */
  static createThrottledRecompute(
    recomputeFn: () => void,
    wait = 100,
  ): (() => void) & { cancel(): void; flush(): void } {
    return _.throttle(recomputeFn, wait);
  }

  /**
   * Update uniforms from object entries
   */
  static updateUniforms(
    uniforms: Record<string, any>,
    additionalUniforms: Record<string, any>,
  ): void {
    for (const [name, value] of Object.entries(additionalUniforms)) {
      uniforms[name] = value;
    }
  }

  /**
   * Convert a number to 64-bit high/low pair for shader uniforms
   */
  static convertTo64BitUniforms(value: number): { high: number; low: number } {
    // This would typically use a utility function like Utils.convertNumberTo64BitTuple
    // For now, providing a basic implementation
    const high = Math.floor(value / 0x100000000);
    const low = value >>> 0;
    return { high, low };
  }
}