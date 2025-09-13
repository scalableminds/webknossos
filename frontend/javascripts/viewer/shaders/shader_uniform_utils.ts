import { M4x4 } from "libs/mjs";
import type TPS3D from "libs/thin_plate_spline";
import _ from "lodash";
import type { DataTexture } from "three";
import type { Uniforms } from "viewer/geometries/materials/plane_material_factory";
import { getTransformsForSkeletonLayer } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import { Store } from "viewer/singletons";

/**
 * Common utility functions for shader uniform management
 */
export class ShaderUniformUtils {
  /**
   * Creates transform-related uniforms for skeleton layers
   */
  static createTransformUniforms(): Record<string, any> {
    const dataset = Store.getState().dataset;
    const nativelyRenderedLayerName =
      Store.getState().datasetConfiguration.nativelyRenderedLayerName;
    
    return {
      transform: {
        value: M4x4.transpose(
          getTransformsForSkeletonLayer(dataset, nativelyRenderedLayerName).affineMatrix,
        ),
      },
    };
  }

  /**
   * Creates additional coordinate uniforms based on current flycam state
   */
  static createAdditionalCoordinateUniforms(): Record<string, any> {
    const { additionalCoordinates } = Store.getState().flycam;
    const uniforms: Record<string, any> = {};

    _.each(additionalCoordinates, (_val, idx) => {
      uniforms[`currentAdditionalCoord_${idx}`] = {
        value: 0,
      };
    });

    return uniforms;
  }

  /**
   * Creates tree-related uniforms for skeleton rendering
   */
  static createTreeUniforms(treeColorTexture: DataTexture): Record<string, any> {
    return {
      activeTreeId: {
        value: Number.NaN,
      },
      treeColors: {
        value: treeColorTexture,
      },
    };
  }

  /**
   * Sets up transform listeners for skeleton layers
   */
  static setupTransformListeners(
    uniforms: Uniforms,
    onTransformUpdate?: (scaledTps: TPS3D | null) => void,
  ): (() => void)[] {
    const listeners: (() => void)[] = [];

    // Listen for transform changes
    listeners.push(
      listenToStoreProperty(
        (storeState) =>
          getTransformsForSkeletonLayer(
            storeState.dataset,
            storeState.datasetConfiguration.nativelyRenderedLayerName,
          ),
        (skeletonTransforms) => {
          const transforms = skeletonTransforms;
          const { affineMatrix } = transforms;

          const scaledTps = transforms.type === "thin_plate_spline" ? transforms.scaledTps : null;

          uniforms.transform.value = M4x4.transpose(affineMatrix);

          if (onTransformUpdate) {
            onTransformUpdate(scaledTps);
          }
        },
      ),
    );

    return listeners;
  }

  /**
   * Sets up additional coordinate listeners
   */
  static setupAdditionalCoordinateListeners(uniforms: Uniforms): (() => void)[] {
    const listeners: (() => void)[] = [];

    listeners.push(
      listenToStoreProperty(
        (storeState) => storeState.flycam.additionalCoordinates,
        (additionalCoordinates) => {
          _.each(additionalCoordinates, (coord, idx) => {
            const uniformKey = `currentAdditionalCoord_${idx}`;
            if (uniforms[uniformKey]) {
              uniforms[uniformKey].value = coord.value;
            }
          });
        },
        true,
      ),
    );

    return listeners;
  }
}

// Import this to avoid circular dependency issues
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";