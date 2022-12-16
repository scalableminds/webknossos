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
import { getRelativeCoords, getWorldCoordUVW, isOutsideOfBoundingBox } from "./coords.glsl";
import { inverse, div, isNan, transDim, isFlightMode } from "./utils.glsl";
import compileShader from "./shader_module_system";
type Params = {
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

<% _.each(colorLayerNames, function(name) { %>
  uniform vec3 <%= name %>_color;
  uniform float <%= name %>_min;
  uniform float <%= name %>_max;
  uniform float <%= name %>_is_inverted;
<% }) %>

<% _.each(layerNamesWithSegmentation, function(name) { %>
  uniform sampler2D <%= name %>_textures[dataTextureCountPerLayer];
  uniform sampler2D <%= name %>_lookup_texture;
  uniform float <%= name %>_data_texture_width;
  uniform float <%= name %>_maxZoomStep;
  uniform float <%= name %>_alpha;
  uniform float <%= name %>_gammaCorrectionValue;
  uniform float <%= name %>_unrenderable;
<% }) %>

<% if (hasSegmentation) { %>
  // Custom color cuckoo table
  uniform highp usampler2D custom_color_texture;
  uniform highp uint seed0;
  uniform highp uint seed1;
  uniform highp uint seed2;
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
uniform vec3 anchorPoint;
uniform vec3 activeSegmentPosition;
uniform float zoomStep;
uniform float zoomValue;
uniform vec3 uvw;
uniform bool useBilinearFiltering;
uniform vec3 globalMousePosition;
uniform bool isMouseInCanvas;
uniform float brushSizeInPixel;
uniform float planeID;
uniform vec3 addressSpaceDimensions;
uniform vec4 hoveredSegmentIdLow;
uniform vec4 hoveredSegmentIdHigh;

varying vec4 worldCoord;
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
  getRelativeCoords,
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
  if (isOutsideOfBoundingBox(worldCoordUVW)) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 relativeCoords = getRelativeCoords(worldCoordUVW, zoomStep);

  vec3 bucketPosition = div(floor(relativeCoords), bucketWidth);
  if (renderBucketIndices) {
    gl_FragColor = vec4(bucketPosition, zoomStep) / 255.;
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
          <%= name %>_lookup_texture,
          <%= formatNumberAsGLSLFloat(layerIndex) %>,
          <%= name %>_data_texture_width,
          <%= formatNumberAsGLSLFloat(packingDegreeLookup[name]) %>,
          worldCoordUVW,
          false,
          fallbackGray
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
  });
}
