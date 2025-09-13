import { Vector3 as ThreeVector3 } from "three";
import type { Vector3 } from "viewer/constants";

/**
 * Uniform factory functions for common shader uniform patterns
 */
export class UniformFactory {
  /**
   * Creates standard visibility/alpha uniforms for a layer
   */
  static createLayerVisibilityUniforms(
    layerName: string,
    alpha = 1.0,
    isUnrenderable = false,
  ): Record<string, any> {
    return {
      [`${layerName}_alpha`]: { value: alpha },
      [`${layerName}_unrenderable`]: { value: isUnrenderable ? 1.0 : 0.0 },
    };
  }

  /**
   * Creates color-related uniforms for a layer
   */
  static createLayerColorUniforms(
    layerName: string,
    color: Vector3,
    min?: number,
    max?: number,
    isInverted = false,
  ): Record<string, any> {
    const uniforms: Record<string, any> = {
      [`${layerName}_color`]: { value: new ThreeVector3(...color) },
      [`${layerName}_is_inverted`]: { value: isInverted ? 1.0 : 0.0 },
    };

    if (min !== undefined) {
      uniforms[`${layerName}_min`] = { value: min };
    }
    if (max !== undefined) {
      uniforms[`${layerName}_max`] = { value: max };
    }

    return uniforms;
  }

  /**
   * Creates transform-related uniforms for a layer
   */
  static createLayerTransformUniforms(
    layerName: string,
    transformMatrix: Float32Array | Array<number>,
    hasTransform = true,
  ): Record<string, any> {
    return {
      [`${layerName}_transform`]: { value: transformMatrix },
      [`${layerName}_has_transform`]: { value: hasTransform },
    };
  }

  /**
   * Creates texture-related uniforms for a layer
   */
  static createLayerTextureUniforms(
    layerName: string,
    textures: any[],
    textureWidth: number,
  ): Record<string, any> {
    return {
      [`${layerName}_textures`]: { value: textures },
      [`${layerName}_data_texture_width`]: { value: textureWidth },
    };
  }

  /**
   * Creates gamma correction uniform for a layer
   */
  static createGammaCorrectionUniform(
    layerName: string,
    gammaCorrectionValue = 1.0,
  ): Record<string, any> {
    return {
      [`${layerName}_gammaCorrectionValue`]: { value: gammaCorrectionValue },
    };
  }

  /**
   * Creates a complete set of layer uniforms
   */
  static createCompleteLayerUniforms(
    layerName: string,
    options: {
      alpha?: number;
      color?: Vector3;
      min?: number;
      max?: number;
      isInverted?: boolean;
      isUnrenderable?: boolean;
      transformMatrix?: Float32Array | Array<number>;
      hasTransform?: boolean;
      textures?: any[];
      textureWidth?: number;
      gammaCorrectionValue?: number;
    } = {},
  ): Record<string, any> {
    const {
      alpha = 1.0,
      color,
      min,
      max,
      isInverted = false,
      isUnrenderable = false,
      transformMatrix,
      hasTransform = true,
      textures,
      textureWidth,
      gammaCorrectionValue = 1.0,
    } = options;

    let uniforms: Record<string, any> = {
      ...UniformFactory.createLayerVisibilityUniforms(layerName, alpha, isUnrenderable),
      ...UniformFactory.createGammaCorrectionUniform(layerName, gammaCorrectionValue),
    };

    if (color) {
      uniforms = {
        ...uniforms,
        ...UniformFactory.createLayerColorUniforms(layerName, color, min, max, isInverted),
      };
    }

    if (transformMatrix) {
      uniforms = {
        ...uniforms,
        ...UniformFactory.createLayerTransformUniforms(layerName, transformMatrix, hasTransform),
      };
    }

    if (textures && textureWidth !== undefined) {
      uniforms = {
        ...uniforms,
        ...UniformFactory.createLayerTextureUniforms(layerName, textures, textureWidth),
      };
    }

    return uniforms;
  }
}