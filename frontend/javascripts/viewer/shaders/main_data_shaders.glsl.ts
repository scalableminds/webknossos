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
uniform mat4 inverseFlycamRotationMatrix;

uniform highp usampler2D lookup_texture;
uniform highp uint lookup_seeds[3];
uniform highp uint LOOKUP_CUCKOO_ENTRY_CAPACITY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_ENTRY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_TEXEL;
uniform highp uint LOOKUP_CUCKOO_TWIDTH;

<% _.each(layerNamesWithSegmentation, function(name) { %>
  uniform highp <%= textureLayerInfos[name].glslPrefix %>sampler2D <%= name %>_textures[<%= textureLayerInfos[name].dataTextureCount %>];
  uniform float <%= name %>_data_texture_width;
  uniform float <%= name %>_alpha;
  uniform float <%= name %>_gammaCorrectionValue;
  uniform float <%= name %>_unrenderable;
  uniform mat4 <%= name %>_transform;
  uniform bool <%= name %>_has_transform;
<% }) %>

<% _.each(colorLayerNames, function(name) { %>
  uniform vec3 <%= name %>_color;
  uniform <%= glslTypeForElementClass(textureLayerInfos[name].elementClass) %> <%= name %>_min;
  uniform <%= glslTypeForElementClass(textureLayerInfos[name].elementClass) %> <%= name %>_max;
  uniform float <%= name %>_is_inverted;
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

export default function getMainFragmentShader(params: Params) {
  const hasSegmentation = params.segmentationLayerNames.length > 0;
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

  <% _.each(segmentationLayerNames, function(segmentationName, layerIndex) { %>
    uint <%= segmentationName %>_id_low = 0u;
    uint <%= segmentationName %>_id_high = 0u;
    uint <%= segmentationName %>_unmapped_id_low = 0u;
    uint <%= segmentationName %>_unmapped_id_high = 0u;
    float <%= segmentationName %>_effective_alpha = <%= segmentationName %>_alpha * (1. - <%= segmentationName %>_unrenderable);

    // If the opacity is > 0, the segment id for the current voxel is read.
    // Since a segmentation might be mapped, the unmapped and (potentially mapped) id
    // is read.
    if (<%= segmentationName %>_effective_alpha > 0.) {
      vec4[2] unmapped_segment_id;
      vec4[2] segment_id;
      getSegmentId_<%= segmentationName %>(worldCoordUVW, unmapped_segment_id, segment_id);

      <%
        const vec4ToSomeIntFn =
          textureLayerInfos[segmentationName].elementClass.endsWith("int64")
            ? textureLayerInfos[segmentationName].isSigned ? "int64ToUint64" : "uint64ToUint64"
            : textureLayerInfos[segmentationName].isSigned ? "int32ToUint64" : "uint32ToUint64"
      %>

      // Temporary vars to which vec4ToSomeIntFn will write
      highp uint hpv_low;
      highp uint hpv_high;

      <%= vec4ToSomeIntFn %>(unmapped_segment_id[1], unmapped_segment_id[0], hpv_low, hpv_high);
      <%= segmentationName %>_unmapped_id_low = uint(hpv_low);
      <%= segmentationName %>_unmapped_id_high = uint(hpv_high);

      <%= vec4ToSomeIntFn %>(segment_id[1], segment_id[0], hpv_low, hpv_high);
      <%= segmentationName %>_id_low = uint(hpv_low);
      <%= segmentationName %>_id_high = uint(hpv_high);
    }

  <% }) %>

  // Get Color Value(s)
  vec3 color_value  = vec3(0.0);
  <% _.each(orderedColorLayerNames, function(name, layerIndex) { %>
    <% const color_layer_index = colorLayerNames.indexOf(name); %>
    float <%= name %>_effective_alpha = <%= name %>_alpha * (1. - <%= name %>_unrenderable);
    if (<%= name %>_effective_alpha > 0.) {
      // Get grayscale value for <%= textureLayerInfos[name].unsanitizedName %>

      <% if (tpsTransformPerLayer[name] != null) { %>
        vec3 transformedCoordUVW = worldCoordUVW + transDim(tpsOffsetXYZ_<%= name %>);
      <% } else { %>
        vec3 transformedCoordUVW = transDim((<%= name %>_transform * vec4(transDim(worldCoordUVW), 1.0)).xyz);
      <% } %>

      if (!isOutsideOfBoundingBox(transformedCoordUVW)) {
        MaybeFilteredColor maybe_filtered_color =
          getMaybeFilteredColorOrFallback(
            <%= formatNumberAsGLSLFloat(color_layer_index) %>,
            <%= name %>_data_texture_width,
            <%= formatNumberAsGLSLFloat(textureLayerInfos[name].packingDegree) %>,
            transformedCoordUVW,
            false,
            fallbackGray,
            !<%= name %>_has_transform
          );
        bool used_fallback = maybe_filtered_color.used_fallback_color;
        float is_max_and_min_equal = float(<%= name %>_max == <%= name %>_min);

        // color_value is usually between 0 and 1.
        color_value = maybe_filtered_color.color.rgb;

        <% const elementClass = textureLayerInfos[name].elementClass %>
        <% if (elementClass.endsWith("int32")) { %>
          // Handle 32-bit color layers

          <% if (elementClass === "int32") { %>
            ivec4 four_bytes = ivec4(255. * maybe_filtered_color.color);
            // Combine bytes into an Int32 (assuming little-endian order)
            highp int hpv = four_bytes.r | (four_bytes.g << 8) | (four_bytes.b << 16) | (four_bytes.a << 24);

            int min = <%= name %>_min;
            int max = <%= name %>_max;
            hpv = clamp(hpv, min, max);

            color_value = vec3(
                scaleIntToFloat(hpv, min, max)
            );
          <% } else { %>
            // Scale from [0,1] to [0,255] so that we can convert to an uint
            // below.
            uvec4 four_bytes = uvec4(255. * maybe_filtered_color.color);
            highp uint hpv =
              uint(four_bytes.a) * uint(pow(256., 3.))
              + uint(four_bytes.b) * uint(pow(256., 2.))
              + uint(four_bytes.g) * 256u
              + uint(four_bytes.r);

            uint min = <%= name %>_min;
            uint max = <%= name %>_max;
            hpv = clamp(hpv, min, max);
            color_value = vec3(
              float(hpv - min) / (float(max - min) + is_max_and_min_equal)
            );
          <% } %>

        <% } else { %>
          <% if (elementClass == "uint24") { %>
            color_value *= 255.;
          <% } else { %>
            color_value = vec3(color_value.x);
          <% } %>

          // Keep the color in bounds of min and max
          color_value = clamp(color_value, <%= name %>_min, <%= name %>_max);
          // Scale the color value according to the histogram settings.
          color_value = vec3(
            scaleFloatToFloat(color_value, <%= name %>_min, <%= name %>_max)
          );
        <% } %>

        color_value = pow(color_value, 1. / vec3(<%= name %>_gammaCorrectionValue));

        // Maybe invert the color using the inverting_factor
        color_value = abs(color_value - <%= name %>_is_inverted);
        // Catch the case where max == min would causes a NaN value and use black as a fallback color.
        color_value = mix(color_value, vec3(0.0), is_max_and_min_equal);
        color_value = color_value * <%= name %>_alpha * <%= name %>_color;
        // Marking the color as invalid by setting alpha to 0.0 if the fallback color has been used
        // so the fallback color does not cover other colors.
        vec4 layer_color = vec4(color_value, used_fallback ? 0.0 : maybe_filtered_color.color.a * <%= name %>_alpha);
        // Calculating the cover color for the current layer in case blendMode == 1.0.
        vec4 additive_color = blendLayersAdditive(data_color, layer_color);
        // Calculating the cover color for the current layer in case blendMode == 0.0.
        vec4 cover_color = blendLayersCover(data_color, layer_color, used_fallback);
        // Choose color depending on blendMode.
        data_color = mix(cover_color, additive_color, float(blendMode == 1.0));
      }
    }
  <% }) %>
  data_color = clamp(data_color, 0.0, 1.0);
  data_color.a = 1.0;

  gl_FragColor = data_color;

  <% if (hasSegmentation) { %>
  <% _.each(segmentationLayerNames, function(segmentationName, layerIndex) { %>

    // Color map (<= to fight rounding mistakes)
    if ( <%= segmentationName %>_id_low != 0u || <%= segmentationName %>_id_high != 0u ) {
      // Increase cell opacity when cell is hovered or if it is the active activeCell
      bool isHoveredSegment = hoveredSegmentIdLow == <%= segmentationName %>_id_low
        && hoveredSegmentIdHigh == <%= segmentationName %>_id_high;
      bool isHoveredUnmappedSegment = hoveredUnmappedSegmentIdLow == <%= segmentationName %>_unmapped_id_low
        && hoveredUnmappedSegmentIdHigh == <%= segmentationName %>_unmapped_id_high;
      bool isActiveCell = activeCellIdLow == <%= segmentationName %>_id_low
         && activeCellIdHigh == <%= segmentationName %>_id_high;
      float alphaIncrement = getSegmentationAlphaIncrement(
        <%= segmentationName %>_alpha,
        isHoveredSegment,
        isHoveredUnmappedSegment,
        isActiveCell
      );

      vec4 segmentColor = convertCellIdToRGB(<%= segmentationName %>_id_high, <%= segmentationName %>_id_low);
      gl_FragColor = vec4(mix(
        data_color.rgb,
        segmentColor.rgb,
        <%= segmentationName %>_alpha  * segmentColor.a + alphaIncrement
      ), 1.0);
    }
    vec4 <%= segmentationName %>_brushOverlayColor = getBrushOverlay(worldCoordUVW);
    <%= segmentationName %>_brushOverlayColor.xyz = convertCellIdToRGB(activeCellIdHigh, activeCellIdLow).rgb;
    gl_FragColor = mix(gl_FragColor, <%= segmentationName %>_brushOverlayColor, <%= segmentationName %>_brushOverlayColor.a);
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
  // This shouldn't really impact the performance as isFlycamRotated is a uniform.
  if(isFlycamRotated || !<%= isOrthogonal %>) {
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
