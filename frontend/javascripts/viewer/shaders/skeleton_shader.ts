import type TPS3D from "libs/thin_plate_spline";
import type { DataTexture } from "three";
import { BaseShader } from "./base_shader";
import { ShaderUniformUtils } from "./shader_uniform_utils";

/**
 * Base class for skeleton-related shaders (nodes, edges) that provides
 * common transform and coordinate handling functionality.
 */
export abstract class SkeletonShader extends BaseShader {
  protected treeColorTexture: DataTexture;

  constructor(materialId: string, treeColorTexture: DataTexture) {
    super(materialId);
    this.treeColorTexture = treeColorTexture;
  }

  protected setupBaseUniforms(): void {
    // Create base uniforms common to skeleton shaders
    Object.assign(
      this.uniforms,
      ShaderUniformUtils.createTreeUniforms(this.treeColorTexture),
      ShaderUniformUtils.createTransformUniforms(),
      ShaderUniformUtils.createAdditionalCoordinateUniforms(),
    );

    // Set up transform listeners with TPS update callback
    this.storePropertyUnsubscribers.push(
      ...ShaderUniformUtils.setupTransformListeners(
        this.uniforms,
        (scaledTps: TPS3D | null) => {
          this.scaledTps = scaledTps;
          this.recomputeVertexShader();
        },
      ),
    );

    // Set up additional coordinate listeners
    this.storePropertyUnsubscribers.push(
      ...ShaderUniformUtils.setupAdditionalCoordinateListeners(this.uniforms),
    );
  }

  protected abstract setupCustomUniforms(): void;
}