// @flow
import { isFlightMode, getW } from "oxalis/shaders/utils.glsl";

import type { ShaderModule } from "./shader_module_system";

export const getResolution: ShaderModule = {
  code: `
    vec3 getResolution(float zoomStep) {
      if (zoomStep == 0.0) {
        return <%= formatVector3AsVec3(resolutions[0]) %>;
      } <% _.range(1, resolutions.length).forEach(resolutionIdx => { %>
      else if (zoomStep == <%= formatNumberAsGLSLFloat(resolutionIdx) %>) {
        return <%= formatVector3AsVec3(resolutions[resolutionIdx]) %>;
      }
      <% }) %>
      else {
        return vec3(0.0, 0.0, 0.0);
      }
    }
  `,
};

export const getResolutionFactors: ShaderModule = {
  requirements: [getResolution],
  code: `
    vec3 getResolutionFactors(float zoomStepA, float zoomStepB) {
      return getResolution(zoomStepA) / getResolution(zoomStepB);
    }
  `,
};

export const getRelativeCoords: ShaderModule = {
  requirements: [getResolution],
  code: `
    vec3 getRelativeCoords(vec3 worldCoordUVW, float usedZoomStep) {
      vec3 resolution = getResolution(usedZoomStep);
      vec3 resolutionUVW = transDim(resolution);

      vec3 anchorPointUVW = transDim(anchorPoint);
      vec3 anchorPointAsGlobalPositionUVW =
        anchorPointUVW * resolutionUVW * bucketWidth;
      vec3 relativeCoords = (worldCoordUVW - anchorPointAsGlobalPositionUVW) / resolutionUVW;

      vec3 coords = transDim(relativeCoords);
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
        vec4 modelCoords = inverse(savedModelMatrix) * worldCoord;
        float sphericalRadius = sphericalCapRadius;

        vec4 centerVertex = vec4(0.0, 0.0, -sphericalRadius, 0.0);
        modelCoords.z = 0.0;
        modelCoords += centerVertex;
        modelCoords.xyz = modelCoords.xyz * (sphericalRadius / length(modelCoords.xyz));
        modelCoords -= centerVertex;

        worldCoordUVW = (savedModelMatrix * modelCoords).xyz;
      }

      vec3 datasetScaleUVW = transDim(datasetScale);

      worldCoordUVW = vec3(
        // For u and w we need to divide by datasetScale because the threejs scene is scaled
        worldCoordUVW.x / datasetScaleUVW.x,
        worldCoordUVW.y / datasetScaleUVW.y,

        // In orthogonal mode, the planes are offset in 3D space to allow skeletons to be rendered before
        // each plane. Since w (e.g., z for xy plane) is
        // the same for all texels computed in this shader, we simply use globalPosition[w] instead
        <% if (isOrthogonal) { %>
          getW(globalPosition)
        <% } else { %>
          worldCoordUVW.z / datasetScaleUVW.z
        <% } %>
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
