import type TPS3D from "libs/thin_plate_spline";
import _ from "lodash";
import type { ElementClass } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import constants, { ViewModeValuesIndices, OrthoViewIndices } from "viewer/constants";
import Constants from "viewer/constants";
import { PLANE_SUBDIVISION } from "viewer/geometries/plane";
import { MAX_ZOOM_STEP_DIFF } from "viewer/model/bucket_data_handling/loading_strategy_logic";
import { MAPPING_TEXTURE_WIDTH } from "viewer/model/bucket_data_handling/mappings";
import { getBlendLayersAdditive, getBlendLayersCover } from "./blending.glsl";
import {
  getAbsoluteCoords,
  getMagnification,
  getWorldCoordUVW,
  isOutsideOfBoundingBox,
} from "./coords.glsl";
import { getMaybeFilteredColorOrFallback } from "./filtering.glsl";
import {
  type LayerShaderParams,
  generateLayerShaderFunction,
  generateLayerUniforms,
} from "./layer_shaders";
import {
  convertCellIdToRGB,
  getBrushOverlay,
  getCrossHairOverlay,
  getSegmentId,
  getSegmentationAlphaIncrement,
} from "./segmentation.glsl";
import compileShader from "./shader_module_system";
import {
  generateCalculateTpsOffsetFunction,
  generateTpsInitialization,
} from "./thin_plate_spline.glsl";
import {
  almostEq,
  div,
  formatNumberAsGLSLFloat,
  glslTypeForElementClass,
  inverse,
  isFlightMode,
  isNan,
  scaleToFloat,
  transDim,
} from "./utils.glsl";

export type Params = {
  globalLayerCount: number;
  colorLayerNames: string[];
  orderedColorLayerNames: string[];
  segmentationLayerNames: string[];
  textureLayerInfos: Record<
    string,
    {
      packingDegree: number;
      dataTextureCount: number;
      isSigned: boolean;
      glslPrefix: "" | "i" | "u";
      elementClass: ElementClass;
      unsanitizedName: string;
      isColor: boolean;
    }
  >;
  magnificationsCount: number;
  voxelSizeFactor: Vector3;
  voxelSizeFactorInverted: Vector3;
  isOrthogonal: boolean;
  tpsTransformPerLayer: Record<string, TPS3D>;
};

const SHARED_UNIFORM_DECLARATIONS = `
uniform vec2 viewportExtent;

uniform float activeMagIndices[<%= globalLayerCount %>];
uniform uint availableLayerIndexToGlobalLayerIndex[<%= globalLayerCount %>];
uniform vec3 allMagnifications[<%= magnificationsCount %>];
uniform uint magnificationCountCumSum[<%= globalLayerCount %>];
uniform bool isFlycamRotated;
uniform bool doAllLayersHaveTransforms;
uniform mat4 inverseFlycamRotationMatrix;

uniform highp usampler2D lookup_texture;
uniform highp uint lookup_seeds[3];
uniform highp uint LOOKUP_CUCKOO_ENTRY_CAPACITY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_ENTRY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_TEXEL;
uniform highp uint LOOKUP_CUCKOO_TWIDTH;

<% _.each(layerUniforms, function(uniformCode) { %>
<%= uniformCode %>
<% }) %>

<% if (hasSegmentation) { %>
  // Custom color cuckoo table
  uniform highp usampler2D custom_color_texture;
  uniform highp uint custom_color_seeds[3];
  uniform highp uint COLOR_CUCKOO_ENTRY_CAPACITY;
  uniform highp uint COLOR_CUCKOO_ELEMENTS_PER_ENTRY;
  uniform highp uint COLOR_CUCKOO_ELEMENTS_PER_TEXEL;
  uniform highp uint COLOR_CUCKOO_TWIDTH;

  uniform uint activeCellIdHigh;
  uniform uint activeCellIdLow;
  uniform bool isMouseInActiveViewport;
  uniform bool showBrush;
  uniform bool isProofreading;
  uniform bool isUnmappedSegmentHighlighted;
  uniform float segmentationPatternOpacity;
  uniform bool hideUnregisteredSegments;

  uniform bool shouldApplyMappingOnGPU;
  uniform bool mappingIsPartial;
  uniform bool hideUnmappedIds;
  uniform bool is_mapping_64bit;
  uniform highp uint mapping_seeds[3];
  uniform highp uint MAPPING_CUCKOO_ENTRY_CAPACITY;
  uniform highp uint MAPPING_CUCKOO_ELEMENTS_PER_ENTRY;
  uniform highp uint MAPPING_CUCKOO_ELEMENTS_PER_TEXEL;
  uniform highp uint MAPPING_CUCKOO_TWIDTH;
  uniform highp usampler2D segmentation_mapping_texture;
<% } %>

uniform float sphericalCapRadius;
uniform bool selectiveVisibilityInProofreading;
uniform float viewMode;
uniform float alpha;
uniform bool renderBucketIndices;
uniform vec3 bboxMin;
uniform vec3 bboxMax;
uniform vec3 positionOffset;
uniform vec3 activeSegmentPosition;
uniform float zoomValue;
uniform bool useBilinearFiltering;
uniform float blendMode;
uniform vec3 globalMousePosition;
uniform bool isMouseInCanvas;
uniform float brushSizeInPixel;
uniform float planeID;
uniform vec3 addressSpaceDimensions;
uniform uint hoveredSegmentIdLow;
uniform uint hoveredSegmentIdHigh;
uniform uint hoveredUnmappedSegmentIdLow;
uniform uint hoveredUnmappedSegmentIdHigh;

// For some reason, taking the dataset scale from the uniform results in imprecise
// rendering of the brush circle (and issues in the arbitrary modes). That's why it
// is directly inserted into the source via templating.
const vec3 voxelSizeFactor = <%= formatVector3AsVec3(voxelSizeFactor) %>;
const vec3 voxelSizeFactorInverted = <%= formatVector3AsVec3(voxelSizeFactorInverted) %>;

const vec4 fallbackGray = vec4(0.5, 0.5, 0.5, 1.0);
const float bucketWidth = <%= bucketWidth %>;
const float bucketSize = <%= bucketSize %>;
`;

function generateLayerShaderParams(params: Params): LayerShaderParams[] {
  const result: LayerShaderParams[] = [];

  // Generate params for color layers
  params.colorLayerNames.forEach((layerName, index) => {
    const textureInfo = params.textureLayerInfos[layerName];
    if (textureInfo) {
      result.push({
        layerName: textureInfo.unsanitizedName,
        sanitizedLayerName: layerName,
        elementClass: textureInfo.elementClass,
        packingDegree: textureInfo.packingDegree,
        isColor: true,
        isSegmentation: false,
        layerIndex: index,
        dataTextureCount: textureInfo.dataTextureCount,
        isSigned: textureInfo.isSigned,
        glslPrefix: textureInfo.glslPrefix,
        hasTransform: true, // Will be set based on actual transform state
        hasTpsTransform: params.tpsTransformPerLayer[layerName] != null,
      });
    }
  });

  // Generate params for segmentation layers
  params.segmentationLayerNames.forEach((layerName, index) => {
    const textureInfo = params.textureLayerInfos[layerName];
    if (textureInfo) {
      result.push({
        layerName: textureInfo.unsanitizedName,
        sanitizedLayerName: layerName,
        elementClass: textureInfo.elementClass,
        packingDegree: textureInfo.packingDegree,
        isColor: false,
        isSegmentation: true,
        layerIndex: index,
        dataTextureCount: textureInfo.dataTextureCount,
        isSigned: textureInfo.isSigned,
        glslPrefix: textureInfo.glslPrefix,
        hasTransform: true, // Will be set based on actual transform state
        hasTpsTransform: params.tpsTransformPerLayer[layerName] != null,
      });
    }
  });

  return result;
}

export default function getMainFragmentShader(params: Params) {
  const hasSegmentation = params.segmentationLayerNames.length > 0;
  const layerShaderParams = generateLayerShaderParams(params);

  // Generate uniforms for each layer
  const layerUniforms = layerShaderParams.map(generateLayerUniforms);

  // Generate layer shader functions
  const layerShaderFunctions = layerShaderParams.map(generateLayerShaderFunction);

  return _.template(`
precision highp float;

${SHARED_UNIFORM_DECLARATIONS}

flat in vec2 index;
flat in uvec4 outputCompressedEntry[<%= globalLayerCount %>];
flat in uint outputMagIdx[<%= globalLayerCount %>];
flat in uint outputSeed[<%= globalLayerCount %>];
flat in float outputAddress[<%= globalLayerCount %>];
in vec4 worldCoord;
in vec4 modelCoord;
in mat4 savedModelMatrix;

<% _.each(layerNamesWithSegmentation, function(name) {
  if (tpsTransformPerLayer[name] != null) { %>
    in vec3 tpsOffsetXYZ_<%= name %>;
<% }
}) %>

${compileShader(
  inverse,
  div,
  isNan,
  isFlightMode,
  transDim,
  getAbsoluteCoords,
  getWorldCoordUVW,
  isOutsideOfBoundingBox,
  getMaybeFilteredColorOrFallback,
  getBlendLayersAdditive,
  getBlendLayersCover,
  hasSegmentation ? convertCellIdToRGB : null,
  hasSegmentation ? getBrushOverlay : null,
  hasSegmentation ? getSegmentId : null,
  hasSegmentation ? getCrossHairOverlay : null,
  hasSegmentation ? getSegmentationAlphaIncrement : null,
  almostEq,
  scaleToFloat,
)}

<% _.each(layerShaderFunctions, function(shaderFunction) { %>
<%= shaderFunction %>
<% }) %>

void main() {
  vec3 worldCoordUVW = getWorldCoordUVW();

  if (renderBucketIndices) {
    // Only used for debugging purposes. Will render bucket positions for the
    // first renderable layer.
    uint globalLayerIndex = availableLayerIndexToGlobalLayerIndex[0u];
    uint activeMagIdx = uint(activeMagIndices[int(globalLayerIndex)]);
    vec3 absoluteCoords = getAbsoluteCoords(worldCoordUVW, activeMagIdx, globalLayerIndex);
    vec3 bucketPosition = div(floor(absoluteCoords), bucketWidth);
    gl_FragColor = vec4(bucketPosition, activeMagIdx) / 255.;
    return;
  }

  vec4 data_color = vec4(0.0);

  // Process color layers using individual layer shaders
  <% _.each(orderedColorLayerNames, function(name) { %>
    data_color = processLayer_<%= name %>(worldCoordUVW, data_color);
  <% }) %>

  data_color = clamp(data_color, 0.0, 1.0);
  data_color.a = 1.0;

  gl_FragColor = data_color;

  // Process segmentation layers using individual layer shaders
  <% if (hasSegmentation) { %>
    <% _.each(segmentationLayerNames, function(segmentationName) { %>
      gl_FragColor = processSegmentationLayer_<%= segmentationName %>(worldCoordUVW, gl_FragColor);
    <% }) %>

    // This will only have an effect in proofreading mode
    vec4 crossHairOverlayColor = getCrossHairOverlay(worldCoordUVW);
    gl_FragColor = mix(gl_FragColor, crossHairOverlayColor, crossHairOverlayColor.a);
    gl_FragColor.a = 1.0;
  <% } %>
}

  `)({
    ...params,
    layerNamesWithSegmentation: params.colorLayerNames.concat(params.segmentationLayerNames),
    layerUniforms,
    layerShaderFunctions,
    ViewModeValuesIndices: _.mapValues(ViewModeValuesIndices, formatNumberAsGLSLFloat),
    bucketWidth: formatNumberAsGLSLFloat(constants.BUCKET_WIDTH),
    bucketSize: formatNumberAsGLSLFloat(constants.BUCKET_SIZE),
    mappingTextureWidth: formatNumberAsGLSLFloat(MAPPING_TEXTURE_WIDTH),
    formatNumberAsGLSLFloat,
    formatVector3AsVec3: (vector3: Vector3) =>
      `vec3(${vector3.map(formatNumberAsGLSLFloat).join(", ")})`,
    OrthoViewIndices: _.mapValues(OrthoViewIndices, formatNumberAsGLSLFloat),
    hasSegmentation,
    isFragment: true,
    glslTypeForElementClass,
  });
}

export function getMainVertexShader(params: Params) {
  const hasSegmentation = params.segmentationLayerNames.length > 0;
  return _.template(`
precision highp float;

out vec4 worldCoord;
out vec4 modelCoord;
out vec2 vUv;
out mat4 savedModelMatrix;
<% _.each(layerNamesWithSegmentation, function(name) {
  if (tpsTransformPerLayer[name] != null) { %>
  out vec3 tpsOffsetXYZ_<%= name %>;
<%
  }
}) %>

flat out vec2 index;
flat out uvec4 outputCompressedEntry[<%= globalLayerCount %>];
flat out uint outputMagIdx[<%= globalLayerCount %>];
flat out uint outputSeed[<%= globalLayerCount %>];
flat out float outputAddress[<%= globalLayerCount %>];

uniform bool is3DViewBeingRendered;
uniform vec3 representativeMagForVertexAlignment;

${SHARED_UNIFORM_DECLARATIONS}

${compileShader(
  inverse,
  div,
  isNan,
  isFlightMode,
  transDim,
  getAbsoluteCoords,
  getWorldCoordUVW,
  isOutsideOfBoundingBox,
  getMaybeFilteredColorOrFallback,
  hasSegmentation ? getSegmentId : null,
  getMagnification,
  almostEq,
)}

float PLANE_WIDTH = ${formatNumberAsGLSLFloat(Constants.VIEWPORT_WIDTH)};
float PLANE_SUBDIVISION = ${formatNumberAsGLSLFloat(PLANE_SUBDIVISION)};

<% _.each(layerNamesWithSegmentation, function(name) {
  if (tpsTransformPerLayer[name] != null) { %>
  <%= generateTpsInitialization(tpsTransformPerLayer, name) %>
  <%= generateCalculateTpsOffsetFunction(name) %>
<% }
}) %>

void main() {
  <% _.each(layerNamesWithSegmentation, function(name) {
    if (tpsTransformPerLayer[name] != null) { %>
    initializeTPSArraysFor<%= name %>();
  <% }
  }) %>

  vUv = uv;
  modelCoord = vec4(position, 1.0);
  savedModelMatrix = modelMatrix;
  worldCoord = modelMatrix * vec4(position, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Early return shader as optimized vertex positioning at bucket borders currently does not work while rotations are active.
  // The same goes when all layers of the dataset are transformed.
  // This shouldn't really impact the performance as isFlycamRotated is a uniform.
  if(isFlycamRotated || !<%= isOrthogonal %> || doAllLayersHaveTransforms) {
    return;
  }
  // Remember the original z position, since it can subtly diverge in the
  // following calculations due to floating point inaccuracies. This can
  // result in artifacts, such as the crosshair disappearing.
  float originalZ = gl_Position.z;

  // Remember, the top of the viewport has Y=1 whereas the left has X=-1.
  vec3 worldCoordTopLeft     = transDim((modelMatrix * vec4(-PLANE_WIDTH/2., -PLANE_WIDTH/2., 0., 1.)).xyz);
  vec3 worldCoordBottomRight = transDim((modelMatrix * vec4( PLANE_WIDTH/2., PLANE_WIDTH/2., 0., 1.)).xyz);

  // The following code ensures that the vertices are aligned with the bucket borders
  // of the currently rendered magnification.
  // In general, an index i is computed for each vertex so that each vertex can be moved
  // to the right/bottom border of the i-th bucket.
  // To ensure that the outer vertices are not moved to the next lower / higher bucket border
  // the vertices are clamped to stay in range of worldCoordTopLeft and worldCoordBottomRight.

  // Calculate the index of the vertex (e.g., index.x=0 is the first horizontal vertex).
  // Let's only consider x:
  // The plane itself is PLANE_WIDTH wide which is why x is in the range [-PLANE_WIDTH/2, +PLANE_WIDTH/2].
  // This is regardless of the scale of the plane (the scale is reflected in the modelMatrix).
  // The calculation transforms x
  //   - to the interval [-1, +1] and then
  //   - to [0, 1] (via (... + 1) / 2) and then
  //   - to [0, PLANE_SUBDIVISION]
  // Rounding is only done to fight potential numerical inaccuracies. In theory, the result should be
  // integer without the rounding.
  index = round((position.xy / (PLANE_WIDTH / 2.) + 1.) / 2. * PLANE_SUBDIVISION);
  // Invert vertical axis to make calculation more intuitive with top-left coordinates.
  index.y = PLANE_SUBDIVISION - index.y;

  // d is the width/height of a bucket in the current magnification.
  vec2 d = transDim(vec3(bucketWidth) * representativeMagForVertexAlignment).xy;

  vec3 voxelSizeFactorUVW = transDim(voxelSizeFactor);
  vec3 voxelSizeFactorInvertedUVW = transDim(voxelSizeFactorInverted);
  vec3 transWorldCoord = transDim(worldCoord.xyz);

  transWorldCoord.x =
    (
      // Left border of left-most bucket (probably outside of visible plane)
      floor(worldCoordTopLeft.x * voxelSizeFactorInvertedUVW.x / d.x) * d.x
      // Move by index.x buckets to the right.
      + index.x * d.x
    ) * voxelSizeFactorUVW.x;

  transWorldCoord.x = clamp(transWorldCoord.x, worldCoordTopLeft.x, worldCoordBottomRight.x);

  transWorldCoord.y =
    (
      // Top border of top-most bucket (probably outside of visible plane)
      floor(worldCoordTopLeft.y * voxelSizeFactorInvertedUVW.y / d.y) * d.y
      // Move by index.y buckets to the bottom.
      + index.y * d.y
    ) * voxelSizeFactorUVW.y;
  transWorldCoord.y = clamp(transWorldCoord.y, worldCoordTopLeft.y, worldCoordBottomRight.y);

  worldCoord = vec4(transDim(transWorldCoord), 1.);

  gl_Position = projectionMatrix * viewMatrix * worldCoord;
  if (!is3DViewBeingRendered) {
    gl_Position.z = originalZ;
  }

  vec3 worldCoordUVW = getWorldCoordUVW();

  <%
  _.each(layerNamesWithSegmentation, function(name) {
    if (tpsTransformPerLayer[name] != null) {
  %>
    tpsOffsetXYZ_<%= name %> = calculateTpsOffsetFor<%= name %>(
      transDim(vec3(transWorldCoord.x, transWorldCoord.y, worldCoordUVW.z))
    );
  <%
    }
  })
  %>

  // Offset the bucket calculation for the current vertex by a voxel to ensure
  // that the provoking vertex (the one that is used by the flat varyings in
  // the corresponding triangle) looks up the correct bucket. Otherwise,
  // a rendering offset of 32 vx occurs.
  worldCoordUVW.x -= 1.;
  worldCoordUVW.y += 1.;

  float NOT_YET_COMMITTED_VALUE = pow(2., 21.) - 1.;

  <% _.each(layerNamesWithSegmentation, function(name, layerIndex) { %>
  if (!<%= name %>_has_transform) {
    float bucketAddress;
    uint globalLayerIndex = availableLayerIndexToGlobalLayerIndex[<%= layerIndex %>u];
    uint activeMagIdx = uint(activeMagIndices[int(globalLayerIndex)]);

    uint renderedMagIdx;
    outputMagIdx[globalLayerIndex] = 100u;
    for (uint i = 0u; i <= ${MAX_ZOOM_STEP_DIFF}u; i++) {
      renderedMagIdx = activeMagIdx + i;
      vec3 coords = floor(getAbsoluteCoords(worldCoordUVW, renderedMagIdx, globalLayerIndex));
      vec3 absoluteBucketPosition = div(coords, bucketWidth);
      bucketAddress = lookUpBucket(
        globalLayerIndex,
        uvec4(uvec3(absoluteBucketPosition), activeMagIdx + i),
        false
      );

      if (bucketAddress != -1. && bucketAddress != NOT_YET_COMMITTED_VALUE) {
        outputMagIdx[globalLayerIndex] = renderedMagIdx;
        break;
      }
    }
  }
  <% }) %>
}
  `)({
    ...params,
    layerNamesWithSegmentation: params.colorLayerNames.concat(params.segmentationLayerNames),
    ViewModeValuesIndices: _.mapValues(ViewModeValuesIndices, formatNumberAsGLSLFloat),
    bucketWidth: formatNumberAsGLSLFloat(constants.BUCKET_WIDTH),
    bucketSize: formatNumberAsGLSLFloat(constants.BUCKET_SIZE),
    mappingTextureWidth: formatNumberAsGLSLFloat(MAPPING_TEXTURE_WIDTH),
    formatNumberAsGLSLFloat,
    formatVector3AsVec3: (vector3: Vector3) =>
      `vec3(${vector3.map(formatNumberAsGLSLFloat).join(", ")})`,
    OrthoViewIndices: _.mapValues(OrthoViewIndices, formatNumberAsGLSLFloat),
    hasSegmentation,
    isFragment: false,
    generateTpsInitialization,
    generateCalculateTpsOffsetFunction,
    glslTypeForElementClass,
  });
}
