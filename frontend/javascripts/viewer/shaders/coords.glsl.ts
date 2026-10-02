import { getW, isFlightMode } from "viewer/shaders/utils.glsl";
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

const worldCoordToUVW: ShaderModule = {
  requirements: [getW, isFlightMode],
  code: `
    vec3 worldCoordToUVW(vec4 worldCoord) {
      vec3 worldCoordUVW = transDim(worldCoord.xyz);
      vec3 positionOffsetUVW = transDim(positionOffset);

      bool isInFlightMode = isFlightMode();

      if (isInFlightMode) {
        vec4 modelCoords = inverseMatrix(savedModelMatrix) * worldCoord;
        float sphericalRadius = sphericalCapRadius;

        vec4 centerVertex = vec4(0.0, 0.0, -sphericalRadius, 0.0);
        modelCoords.z = 0.0;
        modelCoords += centerVertex;
        modelCoords.xyz = modelCoords.xyz * (sphericalRadius / length(modelCoords.xyz));
        modelCoords -= centerVertex;

        worldCoordUVW = (savedModelMatrix * modelCoords).xyz;
      }

      vec3 voxelSizeFactorInvertedUVW = transDim(voxelSizeFactorInverted);

      // We subtract the potential offset of the plane and then
      // need to multiply by voxelSizeFactorInvertedUVW because the threejs scene is scaled.
      worldCoordUVW = (worldCoordUVW - positionOffsetUVW) * voxelSizeFactorInvertedUVW;

      // Numerical imprecision in floating point calculation might cause the w component to be off by one.
      // E.g. if the w component is an integer w = 1.0 in voxel space, the floating point operation via * voxelSizeFactorInvertedUVW
      // which transforms the global coordinates back to voxel space, might end up with w=0.9999, which is wrong.
      // But we know that for unrotated none flight mode planes this is constant.
      // Thus, in this case we can copy over the matching coordinate from the globalPosition uniform to obtain a correct w component.
      if(!isInFlightMode && !isFlycamRotated){
        worldCoordUVW.z = transDim(globalPosition).z;
      }


      return worldCoordUVW;
    }
  `,
};

export const getWorldCoordUVW: ShaderModule = {
  requirements: [worldCoordToUVW],
  code: `
    vec3 getWorldCoordUVW() {
      return worldCoordToUVW(worldCoord);
    }
  `,
};

export const getUnrotatedWorldCoordUVW: ShaderModule = {
  requirements: [worldCoordToUVW],
  code: `
    vec3 getUnrotatedWorldCoordUVW() {
      return worldCoordToUVW(inverseFlycamRotationMatrix * worldCoord);
    }
  `,
};

export const isOutsideOfBoundingBox: ShaderModule = {
  code: `
    bool isOutsideOfBoundingBox(vec3 worldCoordUVW, vec3 bboxMin, vec3 bboxMax) {
      vec3 worldCoord = transDim(worldCoordUVW);
      return (
        worldCoord.x < bboxMin.x || worldCoord.y < bboxMin.y || worldCoord.z < bboxMin.z ||
        worldCoord.x >= bboxMax.x || worldCoord.y >= bboxMax.y || worldCoord.z >= bboxMax.z
      );
    }
  `,
};
