import type TPS3D from "libs/thin_plate_spline";
import each from "lodash-es/each";
import mapValues from "lodash-es/mapValues";
import range from "lodash-es/range";
import template from "lodash-es/template";
import type { ElementClass } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import Constants from "viewer/constants";
import constants, {
  OrthoViewIndices,
  PLANE_SUBDIVISION,
  ViewModeValuesIndices,
} from "viewer/constants";
import {
  COLOR_LAYER_POOL_TEXTURE_WIDTH,
  DTYPE_TAG_INT32,
  DTYPE_TAG_UINT24,
  DTYPE_TAG_UINT32,
  getColorLayerPoolForElementClass,
  getDtypeNormalizerForLayer,
  getDtypeTagForElementClass,
  getSegmentIdDecodeTagForLayer,
} from "viewer/model/bucket_data_handling/data_rendering_logic";
import { MAX_ZOOM_STEP_DIFF } from "viewer/model/bucket_data_handling/loading_strategy_logic";
import { MAPPING_TEXTURE_WIDTH } from "viewer/model/bucket_data_handling/mappings";
import {
  getBlendLayersAdditive,
  getBlendLayersCover,
  getBlendLayersCoverBlackAsTransparent,
} from "./blending.glsl";
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
  getProofreadingCrossHairOverlay,
  getSegmentationAlphaIncrement,
  getSegmentId,
} from "./segmentation.glsl";
import compileShader from "./shader_module_system";
import { getColorForCoords } from "./texture_access.glsl";
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
  scaleToFloat,
  transDim,
} from "./utils.glsl";

export type Params = {
  globalLayerCount: number;
  // colorLayerNames/segmentationLayerNames always contain *all* of the
  // dataset's layers (not just the ones currently toggled on). Which subset
  // is actually blended each frame is controlled purely via the
  // colorRenderOrder/activeColorLayerCount uniforms (see PlaneMaterialFactory),
  // without requiring a shader recompile.
  colorLayerNames: string[];
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
  useInterpolation: boolean;
  tpsTransformPerLayer: Record<string, TPS3D>;
  isWindows: boolean;
  // Fixed, compile-time upper bound for how many color layers can be
  // simultaneously blended. Toggling/reordering which (up to this many) of
  // the declared color layers are active is a pure uniform update.
  maxActiveColorLayers: number;
  // Hardware-derived (see getVertexBucketAlignmentLayerCap in
  // plane_material_factory.ts) upper bound on how many layers' worth of
  // outputMagIdx/outputSeed/outputAddress *varyings* can be declared without
  // exceeding the driver's varying budget. Layers whose global layer index is
  // >= min(globalLayerCount, this) don't get the vertex-precomputed bucket
  // address optimization and always take the slower-but-correct full
  // per-fragment lookup path.
  vertexBucketAlignmentLayerCap: number;
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

// Per-layer rendering metadata. Indexed by the layer's position within
// colorLayerNames.concat(segmentationLayerNames) (the same "compiled index"
// used by availableLayerIndexToGlobalLayerIndex and getRgbaAtXYIndex's
// dispatcher). Unlike the per-layer-named uniforms these arrays replace,
// updating an entry (e.g. toggling alpha to 0, or a different color/min/max)
// never requires a shader recompile.
uniform float layerAlpha[<%= globalLayerCount %>];
uniform float layerGammaCorrectionValue[<%= globalLayerCount %>];
uniform float layerUnrenderable[<%= globalLayerCount %>];
uniform mat4 layerTransform[<%= globalLayerCount %>];
// 0/1 instead of bool[] to sidestep driver/three.js bool-array-uniform quirks.
uniform int layerHasTransformInt[<%= globalLayerCount %>];
uniform vec3 layerBboxMin[<%= globalLayerCount %>];
uniform vec3 layerBboxMax[<%= globalLayerCount %>];

// Only the first colorLayerNames.length entries are meaningful; the
// remaining (segmentation) entries are unused.
uniform vec3 layerColor[<%= globalLayerCount %>];
// For int32/uint32 layers, the true integer min/max is bit-punned into this
// float via intBitsToFloat/uintBitsToFloat (see PlaneMaterialFactory) to
// avoid losing precision beyond float's 24-bit exact integer range; the
// color-blending loop below reverses this via floatBitsToInt/floatBitsToUint
// for those dtypes.
uniform float layerMin[<%= globalLayerCount %>];
uniform float layerMax[<%= globalLayerCount %>];
uniform float layerIsInverted[<%= globalLayerCount %>];

// Which (up to maxActiveColorLayers) of the declared color layers are
// currently blended, and in what order. colorRenderOrder holds indices into
// colorLayerNames (equivalently: compiled indices, since color layers occupy
// compiled indices [0, colorLayerNames.length)). This is the mechanism that
// replaces the old orderedColorLayerNames-driven template unrolling.
uniform int colorRenderOrder[<%= maxActiveColorLayers %>];
uniform int activeColorLayerCount;

// Every layer -- color or segmentation -- reads from one of 5 shared,
// dtype-keyed texture-array pools instead of a dedicated sampler per layer
// -- see getRgbaAtXYIndex in texture_access.glsl.ts. There are always
// exactly 5 of these regardless of how many layers the dataset has.
uniform highp sampler2DArray pool_f32_textures;
uniform highp sampler2DArray pool_u8_textures;
uniform highp sampler2DArray pool_s8_textures;
uniform highp usampler2DArray pool_u16_textures;
uniform highp isampler2DArray pool_s16_textures;

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
uniform vec3 globalPosition;
uniform vec3 positionOffset;
uniform vec3 proofreadingMarkerPosition;
uniform float zoomValue;
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
// rendering of the brush circle (and issues in flight mode). That's why it
// is directly inserted into the source via templating.
const vec3 voxelSizeFactor = <%= formatVector3AsVec3(voxelSizeFactor) %>;
const vec3 voxelSizeFactorInverted = <%= formatVector3AsVec3(voxelSizeFactorInverted) %>;

const vec4 fallbackGray = vec4(0.5, 0.5, 0.5, 1.0);
const float bucketWidth = <%= bucketWidth %>;
const float bucketSize = <%= bucketSize %>;
// Fixed width/height shared by every color/segmentation-layer texture pool
// (see COLOR_LAYER_POOL_TEXTURE_WIDTH in data_rendering_logic.ts); replaces
// what used to be a per-layer d_texture_width uniform now that every layer
// is pool-backed.
const float POOL_TEXTURE_WIDTH = ${formatNumberAsGLSLFloat(COLOR_LAYER_POOL_TEXTURE_WIDTH)};

// See vertexBucketAlignmentLayerCap in Params -- only layers whose *global*
// layer index is below this bound get an entry in the
// outputMagIdx/outputSeed/outputAddress varyings (sized by this same
// constant, not globalLayerCount) and thus the vertex-precomputed bucket
// address optimization; see getColorForCoords64 in texture_access.glsl.ts.
const uint VERTEX_ALIGNMENT_LAYER_CAP = <%= vertexAlignmentLayerCap %>u;

// Static per-(always-declared)-layer metadata that only changes when the set
// of dataset layers itself changes (i.e., exactly when a recompile already
// happens), so it's baked as compile-time constants rather than uniforms.
const float layerPackingDegree[<%= globalLayerCount %>] = float[](<%= layerNamesWithSegmentation.map(function(name) { return formatNumberAsGLSLFloat(textureLayerInfos[name].packingDegree); }).join(", ") %>);
const uint layerDtypeTag[<%= globalLayerCount %>] = uint[](<%= layerNamesWithSegmentation.map(function(name) { return getDtypeTagForElementClass(textureLayerInfos[name].elementClass) + "u"; }).join(", ") %>);
const bool layerHasTpsTransform[<%= globalLayerCount %>] = bool[](<%= layerNamesWithSegmentation.map(function(name) { return tpsTransformPerLayer[name] != null ? "true" : "false"; }).join(", ") %>);
// Only meaningful for color layers (indices [0, colorLayerNames.length)); see
// getRgbaAtXYIndex in texture_access.glsl.ts.
const uint layerPoolId[<%= globalLayerCount %>] = uint[](<%= layerNamesWithSegmentation.map(function(name) { return getColorLayerPoolForElementClass(textureLayerInfos[name].elementClass) + "u"; }).join(", ") %>);
const float layerDtypeNormalizer[<%= globalLayerCount %>] = float[](<%= layerNamesWithSegmentation.map(function(name) { return formatNumberAsGLSLFloat(getDtypeNormalizerForLayer(textureLayerInfos[name])); }).join(", ") %>);
// Only meaningful for segmentation layers (indices [colorLayerNames.length,
// globalLayerCount)); see decodeSegmentId in segmentation.glsl.ts.
const uint layerSegmentIdDecodeTag[<%= globalLayerCount %>] = uint[](<%= layerNamesWithSegmentation.map(function(name) { return getSegmentIdDecodeTagForLayer(textureLayerInfos[name].elementClass, textureLayerInfos[name].isSigned) + "u"; }).join(", ") %>);
`;

export default function getMainFragmentShader(params: Params) {
  const hasSegmentation = params.segmentationLayerNames.length > 0;
  return template(`
precision highp float;

${SHARED_UNIFORM_DECLARATIONS}

flat in vec2 index;
flat in uint outputMagIdx[<%= vertexAlignmentLayerCap %>];
flat in uint outputSeed[<%= vertexAlignmentLayerCap %>];
flat in float outputAddress[<%= vertexAlignmentLayerCap %>];
flat in float useBucketBorderVertexOptimization;
in vec4 worldCoord;
in vec4 modelCoord;
in mat4 savedModelMatrix;

<% each(layerNamesWithSegmentation, function(name) {
  if (tpsTransformPerLayer[name] != null) { %>
    in vec3 tpsOffsetXYZ_<%= name %>;
<% }
}) %>

${compileShader(
  inverse,
  div,
  isFlightMode,
  transDim,
  getAbsoluteCoords,
  getWorldCoordUVW,
  isOutsideOfBoundingBox,
  getMaybeFilteredColorOrFallback,
  getBlendLayersAdditive,
  getBlendLayersCover,
  getBlendLayersCoverBlackAsTransparent,
  hasSegmentation ? convertCellIdToRGB : null,
  hasSegmentation ? getBrushOverlay : null,
  hasSegmentation ? getSegmentId : null,
  hasSegmentation ? getProofreadingCrossHairOverlay : null,
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

  <% if (segmentationLayerNames.length > 0) { %>
  uint segmentIdLow[<%= segmentationLayerNames.length %>];
  uint segmentIdHigh[<%= segmentationLayerNames.length %>];
  uint unmappedIdLow[<%= segmentationLayerNames.length %>];
  uint unmappedIdHigh[<%= segmentationLayerNames.length %>];

  for (int segSlot = 0; segSlot < <%= segmentationLayerNames.length %>; segSlot++) {
    segmentIdLow[segSlot] = 0u;
    segmentIdHigh[segSlot] = 0u;
    unmappedIdLow[segSlot] = 0u;
    unmappedIdHigh[segSlot] = 0u;

    int globalIdx = <%= colorLayerNames.length %> + segSlot;
    float effectiveAlpha = layerAlpha[globalIdx] * (1. - layerUnrenderable[globalIdx]);

    // If the opacity is > 0, the segment id for the current voxel is read.
    // Since a segmentation might be mapped, the unmapped and (potentially mapped) id
    // is read.
    if (effectiveAlpha > 0.) {
      vec4[2] unmapped_segment_id;
      vec4[2] segment_id;
      getSegmentId(globalIdx, worldCoordUVW, unmapped_segment_id, segment_id);

      uint decodeTag = layerSegmentIdDecodeTag[globalIdx];

      // Temporary vars to which decodeSegmentId will write
      highp uint hpv_low;
      highp uint hpv_high;

      decodeSegmentId(decodeTag, unmapped_segment_id[1], unmapped_segment_id[0], hpv_low, hpv_high);
      unmappedIdLow[segSlot] = hpv_low;
      unmappedIdHigh[segSlot] = hpv_high;

      decodeSegmentId(decodeTag, segment_id[1], segment_id[0], hpv_low, hpv_high);
      segmentIdLow[segSlot] = hpv_low;
      segmentIdHigh[segSlot] = hpv_high;
    }
  }
  <% } %>

  // Get Color Value(s). Which (up to maxActiveColorLayers) layers participate
  // and in what order is entirely uniform-driven (colorRenderOrder /
  // activeColorLayerCount) -- toggling/reordering color layers never changes
  // this loop's compiled code.
  vec3 color_value = vec3(0.0);
  vec3 precomputedTpsLayerCoordUVW[<%= globalLayerCount %>];
  <% each(colorLayerNames, function(name, idx) {
    if (tpsTransformPerLayer[name] != null) { %>
      precomputedTpsLayerCoordUVW[<%= idx %>] = worldCoordUVW + transDim(tpsOffsetXYZ_<%= name %>);
  <% }
  }) %>

  for (int colorSlot = 0; colorSlot < activeColorLayerCount; colorSlot++) {
    int layerIdx = colorRenderOrder[colorSlot];
    float effective_alpha = layerAlpha[layerIdx] * (1. - layerUnrenderable[layerIdx]);
    if (effective_alpha > 0.) {
      vec3 layerCoordUVW;
      if (layerHasTpsTransform[layerIdx]) {
        layerCoordUVW = precomputedTpsLayerCoordUVW[layerIdx];
      } else {
        layerCoordUVW = transDim((layerTransform[layerIdx] * vec4(transDim(worldCoordUVW), 1.0)).xyz);
      }

      if (!isOutsideOfBoundingBox(layerCoordUVW, layerBboxMin[layerIdx], layerBboxMax[layerIdx])) {
        MaybeFilteredColor maybe_filtered_color =
          getMaybeFilteredColorOrFallback(
            float(layerIdx),
            POOL_TEXTURE_WIDTH,
            layerPackingDegree[layerIdx],
            layerCoordUVW,
            fallbackGray,
            layerHasTransformInt[layerIdx] == 0
          );
        bool used_fallback = maybe_filtered_color.used_fallback_color;
        float is_max_and_min_equal = float(layerMax[layerIdx] == layerMin[layerIdx]);

        // color_value is usually between 0 and 1.
        color_value = maybe_filtered_color.color.rgb;

        uint dtypeTag = layerDtypeTag[layerIdx];
        if (dtypeTag == ${DTYPE_TAG_INT32}u) {
          // Handle 32-bit signed color layers
          ivec4 four_bytes = ivec4(255. * maybe_filtered_color.color);
          // Combine bytes into an Int32 (assuming little-endian order)
          highp int hpv = four_bytes.r | (four_bytes.g << 8) | (four_bytes.b << 16) | (four_bytes.a << 24);

          int minInt = floatBitsToInt(layerMin[layerIdx]);
          int maxInt = floatBitsToInt(layerMax[layerIdx]);
          hpv = clamp(hpv, minInt, maxInt);

          color_value = vec3(
              scaleIntToFloat(hpv, minInt, maxInt)
          );
        } else if (dtypeTag == ${DTYPE_TAG_UINT32}u) {
          // Handle 32-bit unsigned color layers.
          // Scale from [0,1] to [0,255] so that we can convert to an uint below.
          uvec4 four_bytes = uvec4(255. * maybe_filtered_color.color);
          highp uint hpv =
            uint(four_bytes.a) * uint(pow(256., 3.))
            + uint(four_bytes.b) * uint(pow(256., 2.))
            + uint(four_bytes.g) * 256u
            + uint(four_bytes.r);

          uint minUint = floatBitsToUint(layerMin[layerIdx]);
          uint maxUint = floatBitsToUint(layerMax[layerIdx]);
          hpv = clamp(hpv, minUint, maxUint);
          color_value = vec3(
            float(hpv - minUint) / (float(maxUint - minUint) + is_max_and_min_equal)
          );
        } else {
          if (dtypeTag == ${DTYPE_TAG_UINT24}u) {
            color_value *= 255.;
          } else {
            color_value = vec3(color_value.x);
          }

          // Keep the color in bounds of min and max
          color_value = clamp(color_value, layerMin[layerIdx], layerMax[layerIdx]);
          // Scale the color value according to the histogram settings.
          color_value = vec3(
            scaleFloatToFloat(color_value, layerMin[layerIdx], layerMax[layerIdx])
          );
        }

        color_value = pow(color_value, 1. / vec3(layerGammaCorrectionValue[layerIdx]));

        // Maybe invert the color using the inverting_factor
        color_value = abs(color_value - layerIsInverted[layerIdx]);
        // Catch the case where max == min would causes a NaN value and use black as a fallback color.
        color_value = mix(color_value, vec3(0.0), is_max_and_min_equal);
        color_value = color_value * layerAlpha[layerIdx] * layerColor[layerIdx];
        // Marking the color as invalid by setting alpha to 0.0 if the fallback color has been used
        // so the fallback color does not cover other colors.
        vec4 layer_color = vec4(color_value, used_fallback ? 0.0 : maybe_filtered_color.color.a * layerAlpha[layerIdx]);
        // Calculating the color for the current layer depending on blendMode.
        // blendMode == 1.0: Additive, blendMode == 0.0: Cover, blendMode == 2.0: CoverWithBlackAsTransparent
        vec4 additive_color = blendLayersAdditive(data_color, layer_color);
        vec4 cover_color = blendLayersCover(data_color, layer_color, used_fallback);
        vec4 cover_black_transparent_color = blendLayersCoverBlackAsTransparent(data_color, layer_color, used_fallback);
        data_color = mix(cover_color, additive_color, float(blendMode == 1.0));
        data_color = mix(data_color, cover_black_transparent_color, float(blendMode == 2.0));
      }
    }
  }
  data_color = clamp(data_color, 0.0, 1.0);
  data_color.a = 1.0;

  gl_FragColor = data_color;

  <% if (hasSegmentation) { %>
  for (int segSlot = 0; segSlot < <%= segmentationLayerNames.length %>; segSlot++) {
    int globalIdx = <%= colorLayerNames.length %> + segSlot;

    // Color map (<= to fight rounding mistakes)
    if ( segmentIdLow[segSlot] != 0u || segmentIdHigh[segSlot] != 0u ) {
      // Increase cell opacity when cell is hovered or if it is the active activeCell
      bool isHoveredSegment = hoveredSegmentIdLow == segmentIdLow[segSlot]
        && hoveredSegmentIdHigh == segmentIdHigh[segSlot];
      bool isHoveredUnmappedSegment = hoveredUnmappedSegmentIdLow == unmappedIdLow[segSlot]
        && hoveredUnmappedSegmentIdHigh == unmappedIdHigh[segSlot];
      bool isActiveCell = activeCellIdLow == segmentIdLow[segSlot]
         && activeCellIdHigh == segmentIdHigh[segSlot];
      float alphaIncrement = getSegmentationAlphaIncrement(
        layerAlpha[globalIdx],
        isHoveredSegment,
        isHoveredUnmappedSegment,
        isActiveCell
      );

      vec4 segmentColor = convertCellIdToRGB(segmentIdHigh[segSlot], segmentIdLow[segSlot]);
      gl_FragColor = vec4(mix(
        data_color.rgb,
        segmentColor.rgb,
        layerAlpha[globalIdx]  * segmentColor.a + alphaIncrement
      ), 1.0);
    }
    vec4 brushOverlayColor = getBrushOverlay(worldCoordUVW);
    brushOverlayColor.xyz = convertCellIdToRGB(activeCellIdHigh, activeCellIdLow).rgb;
    gl_FragColor = mix(gl_FragColor, brushOverlayColor, brushOverlayColor.a);
    gl_FragColor.a = 1.0;
  }

  // This will only have an effect in proofreading mode
  vec4 crossHairOverlayColor = getProofreadingCrossHairOverlay(worldCoordUVW);
  gl_FragColor = mix(gl_FragColor, crossHairOverlayColor, crossHairOverlayColor.a);
  gl_FragColor.a = 1.0;

  <% } %>
}

  `)({
    ...params,
    layerNamesWithSegmentation: params.colorLayerNames.concat(params.segmentationLayerNames),
    vertexAlignmentLayerCap: Math.max(
      1,
      Math.min(params.globalLayerCount, params.vertexBucketAlignmentLayerCap),
    ),
    ViewModeValuesIndices: mapValues(ViewModeValuesIndices, formatNumberAsGLSLFloat),
    bucketWidth: formatNumberAsGLSLFloat(constants.BUCKET_WIDTH),
    bucketSize: formatNumberAsGLSLFloat(constants.BUCKET_SIZE),
    mappingTextureWidth: formatNumberAsGLSLFloat(MAPPING_TEXTURE_WIDTH),
    formatNumberAsGLSLFloat,
    formatVector3AsVec3: (vector3: Vector3) =>
      `vec3(${vector3.map(formatNumberAsGLSLFloat).join(", ")})`,
    OrthoViewIndices: mapValues(OrthoViewIndices, formatNumberAsGLSLFloat),
    hasSegmentation,
    isFragment: true,
    glslTypeForElementClass,
    getDtypeTagForElementClass,
    getColorLayerPoolForElementClass,
    getDtypeNormalizerForLayer,
    getSegmentIdDecodeTagForLayer,
    each,
    range,
  });
}

export function getMainVertexShader(params: Params) {
  const hasSegmentation = params.segmentationLayerNames.length > 0;
  return template(`
precision highp float;

out vec4 worldCoord;
out vec4 modelCoord;
out vec2 vUv;
out mat4 savedModelMatrix;
<% each(layerNamesWithSegmentation, function(name) {
  if (tpsTransformPerLayer[name] != null) { %>
  out vec3 tpsOffsetXYZ_<%= name %>;
<%
  }
}) %>

flat out vec2 index;
flat out uint outputMagIdx[<%= vertexAlignmentLayerCap %>];
flat out uint outputSeed[<%= vertexAlignmentLayerCap %>];
flat out float outputAddress[<%= vertexAlignmentLayerCap %>];
// bool varyings are not supported
flat out float useBucketBorderVertexOptimization;

uniform bool is3DViewBeingRendered;
uniform vec3 representativeMagForVertexAlignment;

${SHARED_UNIFORM_DECLARATIONS}

${compileShader(
  inverse,
  div,
  isFlightMode,
  transDim,
  getAbsoluteCoords,
  getColorForCoords,
  getWorldCoordUVW,
  isOutsideOfBoundingBox,
  hasSegmentation ? getSegmentId : null,
  getMagnification,
  almostEq,
)}

float PLANE_WIDTH = ${formatNumberAsGLSLFloat(Constants.VIEWPORT_WIDTH)};
float PLANE_SUBDIVISION = ${formatNumberAsGLSLFloat(PLANE_SUBDIVISION)};

<% each(layerNamesWithSegmentation, function(name) {
  if (tpsTransformPerLayer[name] != null) { %>
  <%= generateTpsInitialization(tpsTransformPerLayer, name) %>
  <%= generateCalculateTpsOffsetFunction(name) %>
<% }
}) %>

void main() {
  <% each(layerNamesWithSegmentation, function(name) {
    if (tpsTransformPerLayer[name] != null) { %>
    initializeTPSArraysFor<%= name %>();
  <% }
  }) %>

  useBucketBorderVertexOptimization = 1.0;

  vUv = uv;
  modelCoord = vec4(position, 1.0);
  savedModelMatrix = modelMatrix;
  worldCoord = modelMatrix * vec4(position, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Early return shader as optimized vertex positioning at bucket borders currently does not work while rotations are active.
  // The same goes when all layers of the dataset are transformed.
  // This shouldn't really impact the performance as isFlycamRotated is a uniform.
  if(isFlycamRotated || !<%= isOrthogonal %> || doAllLayersHaveTransforms) {
    useBucketBorderVertexOptimization = 0.0;
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
  vec2 viewportWidthInVoxelsUV = abs(worldCoordBottomRight.xy - worldCoordTopLeft.xy) / voxelSizeFactorUVW.xy;
  // If the plane subdivision vertices cannot possibly cover all bucket borders, the optimization must not be used.
  // Otherwise, rendering artifacts will occur (partially rendered planes).
  if ((d * PLANE_SUBDIVISION).x < viewportWidthInVoxelsUV.x || (d * PLANE_SUBDIVISION).y < viewportWidthInVoxelsUV.y) {
    useBucketBorderVertexOptimization = 0.0;
    return;
  }

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
  each(layerNamesWithSegmentation, function(name) {
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

  // Precompute the bucket address for every declared layer (color and
  // segmentation) that doesn't have a transform. Which layers actually get
  // rendered/blended this frame is decided purely via uniforms elsewhere, so
  // this loop can be a genuine runtime loop instead of one unrolled per layer.
  // Only layers whose *global* layer index is below VERTEX_ALIGNMENT_LAYER_CAP
  // get an outputMagIdx/outputSeed/outputAddress entry at all -- those arrays
  // are varyings, sized by that same cap rather than globalLayerCount (see
  // its declaration for why); layers beyond the cap always take the slower
  // full per-fragment lookup path in getColorForCoords64, just like
  // transformed layers already do.
  for (uint layerIndex = 0u; layerIndex < uint(<%= globalLayerCount %>); layerIndex++) {
    uint globalLayerIndex = availableLayerIndexToGlobalLayerIndex[layerIndex];
    if (layerHasTransformInt[layerIndex] == 0 && globalLayerIndex < VERTEX_ALIGNMENT_LAYER_CAP) {
      float bucketAddress;
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
  }
}
  `)({
    ...params,
    layerNamesWithSegmentation: params.colorLayerNames.concat(params.segmentationLayerNames),
    vertexAlignmentLayerCap: Math.max(
      1,
      Math.min(params.globalLayerCount, params.vertexBucketAlignmentLayerCap),
    ),
    ViewModeValuesIndices: mapValues(ViewModeValuesIndices, formatNumberAsGLSLFloat),
    bucketWidth: formatNumberAsGLSLFloat(constants.BUCKET_WIDTH),
    bucketSize: formatNumberAsGLSLFloat(constants.BUCKET_SIZE),
    mappingTextureWidth: formatNumberAsGLSLFloat(MAPPING_TEXTURE_WIDTH),
    formatNumberAsGLSLFloat,
    formatVector3AsVec3: (vector3: Vector3) =>
      `vec3(${vector3.map(formatNumberAsGLSLFloat).join(", ")})`,
    OrthoViewIndices: mapValues(OrthoViewIndices, formatNumberAsGLSLFloat),
    hasSegmentation,
    isFragment: false,
    generateTpsInitialization,
    generateCalculateTpsOffsetFunction,
    glslTypeForElementClass,
    getDtypeTagForElementClass,
    getColorLayerPoolForElementClass,
    getDtypeNormalizerForLayer,
    getSegmentIdDecodeTagForLayer,
    each,
    range,
  });
}
