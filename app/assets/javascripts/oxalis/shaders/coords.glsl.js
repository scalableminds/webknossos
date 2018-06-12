// @flow
import type { ShaderModuleType } from "./shader_module_system";
import { getW } from "./utils.glsl";

export const getResolution: ShaderModuleType = {
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

export const getRelativeCoords: ShaderModuleType = {
  requirements: [getResolution],
  code: `
    vec3 getRelativeCoords(vec3 worldCoordUVW, float usedZoomStep) {
      float zoomStepDiff = usedZoomStep - zoomStep;
      bool useFallback = zoomStepDiff > 0.0;
      vec3 usedAnchorPoint = useFallback ? fallbackAnchorPoint : anchorPoint;
      vec3 usedAnchorPointUVW = transDim(usedAnchorPoint);

      vec3 resolution = getResolution(usedZoomStep);
      float zoomValue = pow(2.0, usedZoomStep);

      vec3 resolutionUVW = transDim(resolution);
      vec3 anchorPointAsGlobalPositionUVW =
        usedAnchorPointUVW * resolutionUVW * bucketWidth;
      vec3 relativeCoords = (worldCoordUVW - anchorPointAsGlobalPositionUVW) / resolutionUVW;

      vec3 coords = transDim(relativeCoords);

      return coords;
    }
  `,
};

export const getWorldCoordUVW: ShaderModuleType = {
  requirements: [getW],
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
        isArbitrary() ?
          worldCoordUVW.z / datasetScaleUVW.z
          : getW(globalPosition)
      );

      return worldCoordUVW;
    }
  `,
};
