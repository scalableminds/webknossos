// @flow
import _ from "lodash";
import Dimensions from "oxalis/model/dimensions";
import {
  MAPPING_TEXTURE_WIDTH,
  MAPPING_COLOR_TEXTURE_WIDTH,
} from "oxalis/model/bucket_data_handling/mappings";
import type { Vector3 } from "oxalis/constants";
import { floatsPerLookUpEntry } from "oxalis/model/bucket_data_handling/texture_bucket_manager";
import constants, {
  OrthoViews,
  OrthoViewIndices,
  ModeValuesIndices,
  VolumeToolEnum,
  volumeToolEnumToIndex,
} from "oxalis/constants";

import compileShader from "./shader_module_system";
import { convertCellIdToRGB, getBrushOverlay, getSegmentationId } from "./segmentation.glsl";
import { inverse, round, div, isNan, transDim, isFlightMode } from "./utils.glsl";
import { getRelativeCoords, getWorldCoordUVW } from "./coords.glsl";
import { getMaybeFilteredColorOrFallback } from "./filtering.glsl";

type ParamsType = {|
  colorLayerNames: string[],
  hasSegmentation: boolean,
  segmentationName: string,
  segmentationPackingDegree: number,
  isRgb: boolean,
  isMappingSupported: boolean,
  dataTextureCountPerLayer: number,
  resolutions: Array<Vector3>,
  datasetScale: Vector3,
  isOrthogonal: boolean,
|};

function formatNumberAsGLSLFloat(aNumber: number): string {
  if (aNumber % 1 > 0) {
    // If it is already a floating point number, we can use toString
    return aNumber.toString();
  } else {
    // Otherwise, append ".0" via toFixed
    return aNumber.toFixed(1);
  }
}

export default function getMainFragmentShader(params: ParamsType) {
  const { hasSegmentation } = params;
  return _.template(
    `
precision highp float;
const int dataTextureCountPerLayer = <%= dataTextureCountPerLayer %>;

<% _.each(colorLayerNames, function(name) { %>
  uniform sampler2D <%= name %>_textures[dataTextureCountPerLayer];
  uniform float <%= name %>_data_texture_width;
  uniform sampler2D <%= name %>_lookup_texture;
  uniform float <%= name %>_maxZoomStep;
  uniform float <%= name %>_brightness;
  uniform float <%= name %>_contrast;
  uniform vec3 <%= name %>_color;
  uniform float <%= name %>_weight;
<% }) %>

<% if (hasSegmentation) { %>
  uniform vec4 activeCellId;
  uniform bool isMouseInActiveViewport;
  uniform float activeVolumeToolIndex;
  uniform sampler2D <%= segmentationName %>_lookup_texture;
  uniform sampler2D <%= segmentationName %>_textures[dataTextureCountPerLayer];
  uniform float <%= segmentationName %>_data_texture_width;
  uniform float <%= segmentationName %>_maxZoomStep;

  <% if (isMappingSupported) { %>
    uniform bool isMappingEnabled;
    uniform float mappingSize;
    uniform sampler2D <%= segmentationName %>_mapping_texture;
    uniform sampler2D <%= segmentationName %>_mapping_lookup_texture;
    uniform sampler2D <%= segmentationName %>_mapping_color_texture;
  <% } %>
<% } %>

uniform float sphericalCapRadius;
uniform float viewMode;
uniform float alpha;
uniform bool highlightHoveredCellId;
uniform vec3 globalPosition;
uniform vec3 anchorPoint;
uniform vec3 fallbackAnchorPoint;
uniform float zoomStep;
uniform float zoomValue;
uniform vec3 uvw;
uniform bool useBilinearFiltering;
uniform vec3 globalMousePosition;
uniform bool isMouseInCanvas;
uniform float brushSizeInPixel;
uniform float pixelToVoxelFactor;
uniform float planeID;

varying vec4 worldCoord;
varying vec4 modelCoord;
varying mat4 savedModelMatrix;

const float bucketsPerDim = <%= bucketsPerDim %>;
const float bucketWidth = <%= bucketWidth %>;
const float bucketSize = <%= bucketSize %>;
const float l_texture_width = <%= l_texture_width %>;
const float floatsPerLookUpEntry = <%= floatsPerLookUpEntry %>;

// For some reason, taking the dataset scale from the uniform results is imprecise
// rendering of the brush circle (and issues in the arbitrary modes). That's why it
// is directly inserted into the source via templating.
const vec3 datasetScale = <%= formatVector3AsVec3(datasetScale) %>;

const vec4 fallbackGray = vec4(0.5, 0.5, 0.5, 1.0);

${compileShader(
      inverse,
      div,
      round,
      isNan,
      isFlightMode,
      transDim,
      getRelativeCoords,
      getWorldCoordUVW,
      getMaybeFilteredColorOrFallback,
      hasSegmentation ? convertCellIdToRGB : null,
      hasSegmentation ? getBrushOverlay : null,
      hasSegmentation ? getSegmentationId : null,
    )}

void main() {
  float color_value  = 0.0;

  vec3 worldCoordUVW = getWorldCoordUVW();
  vec3 coords = getRelativeCoords(worldCoordUVW, zoomStep);

  vec3 bucketPosition = div(floor(coords), bucketWidth);
  vec3 offsetInBucket = mod(floor(coords), bucketWidth);

  float fallbackZoomStep = min(<%= colorLayerNames[0]%>_maxZoomStep, zoomStep + 1.0);
  bool hasFallback = fallbackZoomStep > zoomStep;
  vec3 fallbackCoords = floor(getRelativeCoords(worldCoordUVW, fallbackZoomStep));

  <% if (hasSegmentation) { %>
    vec4 id = getSegmentationId(coords, fallbackCoords, hasFallback);

    vec3 flooredMousePosUVW = transDim(floor(globalMousePosition));
    vec3 mousePosCoords = getRelativeCoords(flooredMousePosUVW, zoomStep);

    vec4 cellIdUnderMouse = getSegmentationId(mousePosCoords, fallbackCoords, false);
  <% } %>

  // Get Color Value(s)
  <% if (isRgb) { %>
    vec3 data_color =
      getMaybeFilteredColorOrFallback(
        <%= colorLayerNames[0] %>_lookup_texture,
        0.0, // layerIndex
        <%= colorLayerNames[0] %>_data_texture_width,
        <%= segmentationPackingDegree %>,
        coords,
        fallbackCoords,
        hasFallback,
        false,
        fallbackGray
      ).xyz;

    data_color = (data_color + <%= colorLayerNames[0] %>_brightness - 0.5) * <%= colorLayerNames[0] %>_contrast + 0.5;
  <% } else { %>
    vec3 data_color = vec3(0.0, 0.0, 0.0);
    <% _.each(colorLayerNames, function(name, layerIndex){ %>
      // Get grayscale value for <%= name %>
      color_value =
        getMaybeFilteredColorOrFallback(
          <%= name %>_lookup_texture,
          <%= formatNumberAsGLSLFloat(layerIndex) %>,
          <%= name %>_data_texture_width,
          4.0, // gray scale data is always packed into rgba channels
          coords,
          fallbackCoords,
          hasFallback,
          false,
          fallbackGray
        ).x;

      // Brightness / Contrast Transformation for <%= name %>
      color_value = (color_value + <%= name %>_brightness - 0.5) * <%= name %>_contrast + 0.5;

      // Multiply with color and weight for <%= name %>
      data_color += color_value * <%= name %>_weight * <%= name %>_color;
    <% }) %> ;
    data_color = clamp(data_color, 0.0, 1.0);
  <% } %>

  gl_FragColor = vec4(data_color, 1.0);

  <% if (hasSegmentation) { %>
    // Color map (<= to fight rounding mistakes)
    if ( length(id) > 0.1 ) {
      // Increase cell opacity when cell is hovered
      float hoverAlphaIncrement =
        // Hover cell only if it's the active one, if the feature is enabled
        // and if segmentation opacity is not zero
        cellIdUnderMouse == id && highlightHoveredCellId && alpha > 0.0
          ? 0.2 : 0.0;
      gl_FragColor = vec4(mix( data_color, convertCellIdToRGB(id), alpha + hoverAlphaIncrement ), 1.0);
    }

    vec4 brushOverlayColor = getBrushOverlay(worldCoordUVW);
    brushOverlayColor.xyz = convertCellIdToRGB(activeCellId);
    gl_FragColor = mix(gl_FragColor, brushOverlayColor, brushOverlayColor.a);
  <% } %>
}

  `,
  )({
    ...params,
    colorLayerNames: params.colorLayerNames,
    layerNamesWithSegmentation: params.colorLayerNames.concat(
      params.hasSegmentation ? [params.segmentationName] : [],
    ),
    // Since we concat the segmentation to the color layers, its index is equal
    // to the length of the colorLayer array
    segmentationLayerIndex: params.colorLayerNames.length,
    segmentationPackingDegree: formatNumberAsGLSLFloat(params.segmentationPackingDegree),
    ModeValuesIndices: _.mapValues(ModeValuesIndices, formatNumberAsGLSLFloat),
    OrthoViews,
    bucketWidth: formatNumberAsGLSLFloat(constants.BUCKET_WIDTH),
    bucketSize: formatNumberAsGLSLFloat(constants.BUCKET_SIZE),
    bucketsPerDim: formatNumberAsGLSLFloat(constants.MAXIMUM_NEEDED_BUCKETS_PER_DIMENSION),
    l_texture_width: formatNumberAsGLSLFloat(constants.LOOK_UP_TEXTURE_WIDTH),
    mappingTextureWidth: formatNumberAsGLSLFloat(MAPPING_TEXTURE_WIDTH),
    mappingColorTextureWidth: formatNumberAsGLSLFloat(MAPPING_COLOR_TEXTURE_WIDTH),
    formatNumberAsGLSLFloat,
    formatVector3AsVec3: vector3 => `vec3(${vector3.map(formatNumberAsGLSLFloat).join(", ")})`,
    brushToolIndex: formatNumberAsGLSLFloat(volumeToolEnumToIndex(VolumeToolEnum.BRUSH)),
    floatsPerLookUpEntry: formatNumberAsGLSLFloat(floatsPerLookUpEntry),
    OrthoViewIndices: _.mapValues(OrthoViewIndices, formatNumberAsGLSLFloat),
  });
}
