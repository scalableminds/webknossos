import { getW, isFlightMode } from "oxalis/shaders/utils.glsl";
import type { ShaderModule } from "./shader_module_system";
export const getMagnification: ShaderModule = {
  code: `
    vec3 getMagnification(uint zoomStep, uint globalLayerIndex) {
      return allMagnifications[zoomStep + magnificationCountCumSum[globalLayerIndex]];
    }
  `,
};
export const getMagnificationFactors: ShaderModule = {
  requirements: [getMagnification],
  code: `
    vec3 getMagnificationFactors(uint zoomStepA, uint zoomStepB, uint globalLayerIndex) {
      return getMagnification(zoomStepA, globalLayerIndex) / getMagnification(zoomStepB, globalLayerIndex);
    }
  `,
};
export const getAbsoluteCoords: ShaderModule = {
  requirements: [getMagnification],
  code: `
    vec3 getAbsoluteCoords(vec3 worldCoordUVW, uint usedZoomStep, uint globalLayerIndex) {
      vec3 magnification = getMagnification(usedZoomStep, globalLayerIndex);
      vec3 coords = transDim(worldCoordUVW) / magnification;
      return coords;
    }
  `,
};
export const getWorldCoordUVW: ShaderModule = {
  requirements: [getW, isFlightMode],
  code: `
    vec3 getWorldCoordUVW() {
      vec3 worldCoordUVW = transDim(worldCoord.xyz);

      if (isFlightMode()) {
        vec4 modelCoords = inverseMatrix(savedModelMatrix) * worldCoord;
        float sphericalRadius = sphericalCapRadius;

        vec4 centerVertex = vec4(0.0, 0.0, -sphericalRadius, 0.0);
        modelCoords.z = 0.0;
        modelCoords += centerVertex;
        modelCoords.xyz = modelCoords.xyz * (sphericalRadius / length(modelCoords.xyz));
        modelCoords -= centerVertex;

        worldCoordUVW = (savedModelMatrix * modelCoords).xyz;
      }

      vec3 voxelSizeFactorUVW = transDim(voxelSizeFactor);

      worldCoordUVW = vec3(
        // For u and w we need to divide by voxelSizeFactor because the threejs scene is scaled
        worldCoordUVW.x / voxelSizeFactorUVW.x,
        worldCoordUVW.y / voxelSizeFactorUVW.y,

        // In orthogonal mode, the planes are offset in 3D space to allow skeletons to be rendered before
        // each plane. Since w (e.g., z for xy plane) is
        // the same for all texels computed in this shader, we simply use globalPosition[w] instead
        // TODOM: if not rotated, getW can be used
        worldCoordUVW.z / voxelSizeFactorUVW.z
      );

      return worldCoordUVW;
    }
  `,
};
export const isOutsideOfBoundingBox: ShaderModule = {
  code: `
    bool isOutsideOfBoundingBox(vec3 worldCoordUVW) {
      vec3 worldCoord = transDim(worldCoordUVW);
      return (
        worldCoord.x < bboxMin.x || worldCoord.y < bboxMin.y || worldCoord.z < bboxMin.z ||
        worldCoord.x >= bboxMax.x || worldCoord.y >= bboxMax.y || worldCoord.z >= bboxMax.z
      );
    }
  `,
};
