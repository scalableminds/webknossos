import _ from "lodash";
import { MAPPING_TEXTURE_WIDTH } from "oxalis/model/bucket_data_handling/mappings";
import type { Vector3 } from "oxalis/constants";
import constants, { ViewModeValuesIndices, OrthoViewIndices } from "oxalis/constants";
import {
  convertCellIdToRGB,
  getBrushOverlay,
  getCrossHairOverlay,
  getSegmentationId,
} from "./segmentation.glsl";
import { getMaybeFilteredColorOrFallback } from "./filtering.glsl";
import {
  getAbsoluteCoords,
  getResolution,
  getWorldCoordUVW,
  isOutsideOfBoundingBox,
} from "./coords.glsl";
import { inverse, div, isNan, transDim, isFlightMode } from "./utils.glsl";
import compileShader from "./shader_module_system";
type Params = {
  globalLayerCount: number;
  colorLayerNames: string[];
  segmentationLayerNames: string[];
  packingDegreeLookup: Record<string, number>;
  dataTextureCountPerLayer: number;
  resolutions: Array<Vector3>;
  datasetScale: Vector3;
  isOrthogonal: boolean;
  lookupTextureWidth: number;
};
export function formatNumberAsGLSLFloat(aNumber: number): string {
  if (aNumber % 1 > 0) {
    // If it is already a floating point number, we can use toString
    return aNumber.toString();
  } else {
    // Otherwise, append ".0" via toFixed
    return aNumber.toFixed(1);
  }
}
export default function getMainFragmentShader(params: Params) {
  const hasSegmentation = params.segmentationLayerNames.length > 0;
  return _.template(`
precision highp float;
const int dataTextureCountPerLayer = <%= dataTextureCountPerLayer %>;
uniform highp usampler2D lookup_texture;
uniform highp uint lookup_seeds[3];
uniform highp uint LOOKUP_CUCKOO_ENTRY_CAPACITY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_ENTRY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_TEXEL;
uniform highp uint LOOKUP_CUCKOO_TWIDTH;

<% _.each(colorLayerNames, function(name) { %>
  uniform vec3 <%= name %>_color;
  uniform float <%= name %>_min;
  uniform float <%= name %>_max;
  uniform float <%= name %>_is_inverted;
  uniform mat4 <%= name %>_transform;
  uniform bool <%= name %>_has_transform;
<% }) %>

<% _.each(layerNamesWithSegmentation, function(name) { %>
  uniform sampler2D <%= name %>_textures[dataTextureCountPerLayer];
  uniform float <%= name %>_data_texture_width;
  uniform float <%= name %>_alpha;
  uniform float <%= name %>_gammaCorrectionValue;
  uniform float <%= name %>_unrenderable;
<% }) %>

uniform float activeMagIndices[<%= globalLayerCount %>];
uniform uint availableLayerIndexToGlobalLayerIndex[<%= globalLayerCount %>];
uniform vec3 resolutions[20];

<% if (hasSegmentation) { %>
  // Custom color cuckoo table
  uniform highp usampler2D custom_color_texture;
  uniform highp uint custom_color_seeds[3];
  uniform highp uint CUCKOO_ENTRY_CAPACITY;
  uniform highp uint CUCKOO_ELEMENTS_PER_ENTRY;
  uniform highp uint CUCKOO_ELEMENTS_PER_TEXEL;
  uniform highp uint CUCKOO_TWIDTH;

  uniform vec4 activeCellIdHigh;
  uniform vec4 activeCellIdLow;
  uniform bool isMouseInActiveViewport;
  uniform bool showBrush;
  uniform bool isProofreading;
  uniform float segmentationPatternOpacity;

  uniform bool isMappingEnabled;
  uniform float mappingSize;
  uniform bool hideUnmappedIds;
  uniform sampler2D segmentation_mapping_texture;
  uniform sampler2D segmentation_mapping_lookup_texture;
<% } %>

uniform float sphericalCapRadius;
uniform float viewMode;
uniform float alpha;
uniform bool renderBucketIndices;
uniform vec3 bboxMin;
uniform vec3 bboxMax;
uniform vec3 globalPosition;
uniform vec3 activeSegmentPosition;
uniform float zoomValue;
uniform bool useBilinearFiltering;
uniform vec3 globalMousePosition;
uniform bool isMouseInCanvas;
uniform float brushSizeInPixel;
uniform float planeID;
uniform vec3 addressSpaceDimensions;
uniform vec4 hoveredSegmentIdLow;
uniform vec4 hoveredSegmentIdHigh;

flat in vec2 index;
flat in vec3 flatVertexPos;
flat in uvec4 outputCompressedEntry[<%= globalLayerCount %>];
flat in uint outputMagIdx[<%= globalLayerCount %>];
flat in uint outputSeed[<%= globalLayerCount %>];
flat in float outputAddress[<%= globalLayerCount %>];
in vec4 worldCoord;
varying vec4 modelCoord;
varying mat4 savedModelMatrix;

const float bucketWidth = <%= bucketWidth %>;
const float bucketSize = <%= bucketSize %>;
const float l_texture_width = <%= l_texture_width %>;


// For some reason, taking the dataset scale from the uniform results in imprecise
// rendering of the brush circle (and issues in the arbitrary modes). That's why it
// is directly inserted into the source via templating.
const vec3 datasetScale = <%= formatVector3AsVec3(datasetScale) %>;

const vec4 fallbackGray = vec4(0.5, 0.5, 0.5, 1.0);

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
  hasSegmentation ? convertCellIdToRGB : null,
  hasSegmentation ? getBrushOverlay : null,
  hasSegmentation ? getSegmentationId : null,
  hasSegmentation ? getCrossHairOverlay : null,
)}

void main() {
  vec3 worldCoordUVW = getWorldCoordUVW();

  if (floor(flatVertexPos.x) == floor(worldCoordUVW.x) && floor(flatVertexPos.y) == floor(worldCoordUVW.y)) {
    gl_FragColor = vec4(1., 0., 1., 1.);
    // return;
  }

  if (index.x == 200.) {
      gl_FragColor = vec4(0., 1., 1., 1.);
//      return;
  }




  if (renderBucketIndices) {
    // Only used for debugging purposes. Will render bucket positions for the
    // first renderable layer.
    uint globalLayerIndex = availableLayerIndexToGlobalLayerIndex[0u];
    uint activeMagIdx = uint(activeMagIndices[int(globalLayerIndex)]);
    vec3 absoluteCoords = getAbsoluteCoords(worldCoordUVW, activeMagIdx);
    vec3 bucketPosition = div(floor(absoluteCoords), bucketWidth);
    gl_FragColor = vec4(bucketPosition, activeMagIdx) / 255.;
    return;
  }
  vec3 data_color = vec3(0.0);

  <% _.each(segmentationLayerNames, function(segmentationName, layerIndex) { %>
    vec4 <%= segmentationName%>_id_low = vec4(0.);
    vec4 <%= segmentationName%>_id_high = vec4(0.);
    float <%= segmentationName%>_effective_alpha = <%= segmentationName %>_alpha * (1. - <%= segmentationName %>_unrenderable);

    if (<%= segmentationName%>_effective_alpha > 0.) {
      vec4[2] segmentationId = getSegmentationId_<%= segmentationName%>(worldCoordUVW);
      <%= segmentationName%>_id_low = segmentationId[1];
      <%= segmentationName%>_id_high = segmentationId[0];
    }

  <% }) %>

  // Get Color Value(s)
  vec3 color_value  = vec3(0.0);
  <% _.each(colorLayerNames, function(name, layerIndex) { %>
    float <%= name %>_effective_alpha = <%= name %>_alpha * (1. - <%= name %>_unrenderable);
    if (<%= name %>_effective_alpha > 0.) {
      // Get grayscale value for <%= name %>
      color_value =
        getMaybeFilteredColorOrFallback(
          lookup_texture,
          <%= formatNumberAsGLSLFloat(layerIndex) %>,
          <%= name %>_data_texture_width,
          <%= formatNumberAsGLSLFloat(packingDegreeLookup[name]) %>,
          transDim((<%= name %>_transform * vec4(transDim(worldCoordUVW), 1.0)).xyz),
          false,
          fallbackGray,
          !<%= name %>_has_transform
        ).xyz;

      <% if (packingDegreeLookup[name] === 2.0) { %>
        // Workaround for 16-bit color layers
        color_value = vec3(color_value.g * 256.0 + color_value.r);
      <% } %>
      // Keep the color in bounds of min and max
      color_value = clamp(color_value, <%= name %>_min, <%= name %>_max);
      // Scale the color value according to the histogram settings.
      // Note: max == min would cause a division by 0. Thus we add 1 in this case and hide that value below
      // via mixing.
      float is_max_and_min_equal = float(<%= name %>_max == <%= name %>_min);
      color_value = (color_value - <%= name %>_min) / (<%= name %>_max - <%= name %>_min + is_max_and_min_equal);

      color_value = pow(color_value, 1. / vec3(<%= name %>_gammaCorrectionValue));

      // Maybe invert the color using the inverting_factor
      color_value = abs(color_value - <%= name %>_is_inverted);
      // Catch the case where max == min would causes a NaN value and use black as a fallback color.
      color_value = mix(color_value, vec3(0.0), is_max_and_min_equal);
      // Multiply with color and alpha for <%= name %>
      data_color += color_value * <%= name %>_alpha * <%= name %>_color;
    }
  <% }) %>
  data_color = clamp(data_color, 0.0, 1.0);

  gl_FragColor = vec4(data_color, 1.0);

  <% if (hasSegmentation) { %>
  <% _.each(segmentationLayerNames, function(segmentationName, layerIndex) { %>

    // Color map (<= to fight rounding mistakes)
    if ( length(<%= segmentationName%>_id_low) > 0.1 || length(<%= segmentationName%>_id_high) > 0.1 ) {
      // Increase cell opacity when cell is hovered or if it is the active activeCell
      bool isHoveredCell = hoveredSegmentIdLow == <%= segmentationName%>_id_low
        && hoveredSegmentIdHigh == <%= segmentationName%>_id_high;
      bool isActiveCell = activeCellIdLow == <%= segmentationName%>_id_low
         && activeCellIdHigh == <%= segmentationName%>_id_high;
      // Highlight cell only if it's hovered or active during proofreading
      // and if segmentation opacity is not zero
      float hoverAlphaIncrement = isHoveredCell && <%= segmentationName%>_alpha > 0.0 ? 0.2 : 0.0;
      float proofreadingAlphaIncrement = isActiveCell && isProofreading && <%= segmentationName%>_alpha > 0.0 ? 0.4 : 0.0;
      gl_FragColor = vec4(mix(
        data_color,
        convertCellIdToRGB(<%= segmentationName%>_id_high, <%= segmentationName%>_id_low),
        <%= segmentationName%>_alpha + max(hoverAlphaIncrement, proofreadingAlphaIncrement)
      ), 1.0);
    }
    vec4 <%= segmentationName%>_brushOverlayColor = getBrushOverlay(worldCoordUVW);
    <%= segmentationName%>_brushOverlayColor.xyz = convertCellIdToRGB(activeCellIdHigh, activeCellIdLow);
    gl_FragColor = mix(gl_FragColor, <%= segmentationName%>_brushOverlayColor, <%= segmentationName%>_brushOverlayColor.a);
    gl_FragColor.a = 1.0;

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
    ViewModeValuesIndices: _.mapValues(ViewModeValuesIndices, formatNumberAsGLSLFloat),
    bucketWidth: formatNumberAsGLSLFloat(constants.BUCKET_WIDTH),
    bucketSize: formatNumberAsGLSLFloat(constants.BUCKET_SIZE),
    l_texture_width: formatNumberAsGLSLFloat(params.lookupTextureWidth),
    mappingTextureWidth: formatNumberAsGLSLFloat(MAPPING_TEXTURE_WIDTH),
    formatNumberAsGLSLFloat,
    formatVector3AsVec3: (vector3: Vector3) =>
      `vec3(${vector3.map(formatNumberAsGLSLFloat).join(", ")})`,
    OrthoViewIndices: _.mapValues(OrthoViewIndices, formatNumberAsGLSLFloat),
    hasSegmentation,
    isFragment: true,
  });
}

export function getMainVertexShader(params: Params) {
  const hasSegmentation = params.segmentationLayerNames.length > 0;
  return _.template(`
precision highp float;


out vec4 worldCoord;
flat out vec2 index;
flat out vec3 flatVertexPos;
flat out uvec4 outputCompressedEntry[<%= globalLayerCount %>];
flat out uint outputMagIdx[<%= globalLayerCount %>];
flat out uint outputSeed[<%= globalLayerCount %>];
flat out float outputAddress[<%= globalLayerCount %>];
varying vec4 modelCoord;
varying vec2 vUv;
varying mat4 savedModelMatrix;




const int dataTextureCountPerLayer = <%= dataTextureCountPerLayer %>;
uniform highp usampler2D lookup_texture;
uniform highp uint lookup_seeds[3];
uniform highp uint LOOKUP_CUCKOO_ENTRY_CAPACITY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_ENTRY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_TEXEL;
uniform highp uint LOOKUP_CUCKOO_TWIDTH;

<% _.each(colorLayerNames, function(name) { %>
  uniform vec3 <%= name %>_color;
  uniform float <%= name %>_min;
  uniform float <%= name %>_max;
  uniform float <%= name %>_is_inverted;
  uniform mat4 <%= name %>_transform;
  uniform bool <%= name %>_has_transform;
<% }) %>

<% _.each(layerNamesWithSegmentation, function(name) { %>
  uniform sampler2D <%= name %>_textures[dataTextureCountPerLayer];
  uniform float <%= name %>_data_texture_width;
  uniform float <%= name %>_alpha;
  uniform float <%= name %>_gammaCorrectionValue;
  uniform float <%= name %>_unrenderable;
<% }) %>

uniform float activeMagIndices[<%= globalLayerCount %>];
uniform uint availableLayerIndexToGlobalLayerIndex[<%= globalLayerCount %>];
uniform vec3 resolutions[20];
uniform int representativeLayerIdxForMag;

<% if (hasSegmentation) { %>
  // Custom color cuckoo table
  uniform highp usampler2D custom_color_texture;
  uniform highp uint custom_color_seeds[3];
  uniform highp uint CUCKOO_ENTRY_CAPACITY;
  uniform highp uint CUCKOO_ELEMENTS_PER_ENTRY;
  uniform highp uint CUCKOO_ELEMENTS_PER_TEXEL;
  uniform highp uint CUCKOO_TWIDTH;

  uniform vec4 activeCellIdHigh;
  uniform vec4 activeCellIdLow;
  uniform bool isMouseInActiveViewport;
  uniform bool showBrush;
  uniform bool isProofreading;
  uniform float segmentationPatternOpacity;

  uniform bool isMappingEnabled;
  uniform float mappingSize;
  uniform bool hideUnmappedIds;
  uniform sampler2D segmentation_mapping_texture;
  uniform sampler2D segmentation_mapping_lookup_texture;
<% } %>

uniform float sphericalCapRadius;
uniform float viewMode;
uniform float alpha;
uniform bool renderBucketIndices;
uniform vec3 bboxMin;
uniform vec3 bboxMax;
uniform vec3 globalPosition;
uniform vec3 activeSegmentPosition;
uniform float zoomValue;
uniform bool useBilinearFiltering;
uniform vec3 globalMousePosition;
uniform bool isMouseInCanvas;
uniform float brushSizeInPixel;
uniform float planeID;
uniform vec3 addressSpaceDimensions;
uniform vec4 hoveredSegmentIdLow;
uniform vec4 hoveredSegmentIdHigh;

const float bucketWidth = <%= bucketWidth %>;
const float bucketSize = <%= bucketSize %>;
const float l_texture_width = <%= l_texture_width %>;


// For some reason, taking the dataset scale from the uniform results in imprecise
// rendering of the brush circle (and issues in the arbitrary modes). That's why it
// is directly inserted into the source via templating.
const vec3 datasetScale = <%= formatVector3AsVec3(datasetScale) %>;

const vec4 fallbackGray = vec4(0.5, 0.5, 0.5, 1.0);

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
  hasSegmentation ? getSegmentationId : null,
  getResolution,
)}




void main() {
  vUv = uv;
  modelCoord = vec4(position, 1.0);
  savedModelMatrix = modelMatrix;
mat4 modelInv = inverseMatrix(modelMatrix);
  worldCoord = modelMatrix * vec4(position, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

  float planeWidth = 376.;
  float subdivisionCount = 200.;

  // Remember, the top of the viewport has Y=1 whereas the left has X=-1.
  vec3 worldCoordTopLeft     = transDim((modelMatrix * vec4(vec3(-planeWidth/2.,  planeWidth/2., 0.), 1.)).xyz);
  vec3 worldCoordBottomRight = transDim((modelMatrix * vec4(vec3( planeWidth/2., -planeWidth/2., 0.), 1.)).xyz);

  // vec3 positionUVW = transDim(position);
  // vec2 index = (positionUVW.xy / (planeWidth / 2.) + 1.) / 2. * subdivisionCount;
  index = (position.xy / (planeWidth / 2.) + 1.) / 2. * subdivisionCount;

  // Depending on the amount of vertices and the zoom value, it could be
  // that not only the first/last vertices have to be pinned, but multiple ones
  // might need pinning (otherwise, the second vertex is moved by 32 vx which could
  // move it in front of the first vertex).
  // Also:
  // These border vertices might need special handling regarding the worldCoordUVW
  // biasing.

  // instead of clamping all vertices, they are enumerated so that the first/last few
  // are still clipped to the plane boundary.
  if (true) {
    uint activeMagIdx = uint(activeMagIndices[representativeLayerIdxForMag]);
    vec2 d = transDim(vec3(32.) * getResolution(activeMagIdx)).xy;

    vec3 datasetScaleUVW = transDim(datasetScale);
    vec3 transWorldCoord = transDim(worldCoord.xyz);

    if (index.x >= 1. && index.x <= subdivisionCount - 2.) {
      transWorldCoord.x = floor(transWorldCoord.x / datasetScaleUVW.x / d.x) * d.x * datasetScaleUVW.x;
      transWorldCoord.x = clamp(transWorldCoord.x, worldCoordTopLeft.x, worldCoordBottomRight.x);
    } else if (index.x == subdivisionCount - 1.) {
      // The second-last vertex should be clipped to the next-lower bucket boundary beginning from
      // worldCoordBottomRight.
      transWorldCoord.x = floor(worldCoordBottomRight.x / datasetScaleUVW.x / d.x) * d.x * datasetScaleUVW.x;
    }

    if (index.y >= 1. && index.y <= subdivisionCount - 1.) {
      transWorldCoord.y = floor(transWorldCoord.y / datasetScaleUVW.y / d.y) * d.y * datasetScaleUVW.y;
      transWorldCoord.y = clamp(transWorldCoord.y, worldCoordTopLeft.y, worldCoordBottomRight.y);
    } else if (index.y == subdivisionCount - 1.) {
      // The second-last vertex should be clipped to the next-lower bucket boundary beginning from
      // worldCoordBottomRight.
      transWorldCoord.y = floor(worldCoordBottomRight.y / datasetScaleUVW.y / d.y) * d.y * datasetScaleUVW.y;
    }

    worldCoord = vec4(transDim(transWorldCoord), 1.);
    vec3 posRec = (modelInv * worldCoord).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(posRec, 1.0);
  }

  vec3 worldCoordUVW = getWorldCoordUVW();

  // Offset the bucket calculation for the current vertex by a bit
  // to avoid picking the wrong bucket (which would lead to an rendering offset
  // of 32 vx).
  // still necessary?
  if (true && (index.x > 0. && index.x < 200.)) {
    worldCoordUVW.x -= 1.;
    worldCoordUVW.y += 1.;
  } else if (index.x == subdivisionCount - 1.) {
    worldCoordUVW.x -= 1.;
    worldCoordUVW.y += 1.;
  } else {
    worldCoordUVW.x -= 1.;
    worldCoordUVW.y += 1.;
  }

  flatVertexPos = worldCoordUVW;
  float NOT_YET_COMMITTED_VALUE = pow(2., 21.) - 1.;
  const float bucketWidth = 32.;
  const float bucketSize = 32.*32.*32.;

  const uint FALLBACK_COUNT = 3u;

  // todo: seg layer is missing!
  <% _.each(colorLayerNames, function(name, layerIndex) { %>
  if (!<%= name %>_has_transform) {
    float bucketAddress;
    uint globalLayerIndex = availableLayerIndexToGlobalLayerIndex[<%= layerIndex %>u];
    uint activeMagIdx = uint(activeMagIndices[int(globalLayerIndex)]);

    uint renderedMagIdx;
    outputMagIdx[globalLayerIndex] = 100u;
    for (uint i = 0u; i < FALLBACK_COUNT; i++) {
      renderedMagIdx = activeMagIdx + i;
      vec3 coords = floor(getAbsoluteCoords(worldCoordUVW, renderedMagIdx));
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
    l_texture_width: formatNumberAsGLSLFloat(params.lookupTextureWidth),
    mappingTextureWidth: formatNumberAsGLSLFloat(MAPPING_TEXTURE_WIDTH),
    formatNumberAsGLSLFloat,
    formatVector3AsVec3: (vector3: Vector3) =>
      `vec3(${vector3.map(formatNumberAsGLSLFloat).join(", ")})`,
    OrthoViewIndices: _.mapValues(OrthoViewIndices, formatNumberAsGLSLFloat),
    hasSegmentation,
    isFragment: false,
  });
}
