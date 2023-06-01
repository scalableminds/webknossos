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
import Constants from "oxalis/constants";
import { PLANE_SUBDIVISION } from "oxalis/geometries/plane";
import { MAX_ZOOM_STEP_DIFF } from "oxalis/model/bucket_data_handling/loading_strategy_logic";
import { getBlendLayersAdditive, getBlendLayersCover } from "./blending.glsl";

type Params = {
  globalLayerCount: number;
  colorLayerNames: string[];
  segmentationLayerNames: string[];
  textureLayerInfos: Record<string, { packingDegree: number; dataTextureCount: number }>;
  resolutionsCount: number;
  datasetScale: Vector3;
  isOrthogonal: boolean;
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

const SHARED_UNIFORM_DECLARATIONS = `
uniform vec2 viewportExtent;

uniform float activeMagIndices[<%= globalLayerCount %>];
uniform uint availableLayerIndexToGlobalLayerIndex[<%= globalLayerCount %>];
uniform vec3 allResolutions[<%= resolutionsCount %>];
uniform uint resolutionCountCumSum[<%= globalLayerCount %>];

uniform highp usampler2D lookup_texture;
uniform highp uint lookup_seeds[3];
uniform highp uint LOOKUP_CUCKOO_ENTRY_CAPACITY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_ENTRY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_TEXEL;
uniform highp uint LOOKUP_CUCKOO_TWIDTH;

<% _.each(layerNamesWithSegmentation, function(name) { %>
  uniform sampler2D <%= name %>_textures[<%= textureLayerInfos[name].dataTextureCount %>];
  uniform float <%= name %>_data_texture_width;
  uniform float <%= name %>_alpha;
  uniform float <%= name %>_gammaCorrectionValue;
  uniform float <%= name %>_unrenderable;
  uniform mat4 <%= name %>_transform;
  uniform bool <%= name %>_has_transform;
<% }) %>

<% _.each(colorLayerNames, function(name) { %>
  uniform vec3 <%= name %>_color;
  uniform float <%= name %>_min;
  uniform float <%= name %>_max;
  uniform float <%= name %>_is_inverted;
<% }) %>

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
uniform float blendMode;
uniform vec3 globalMousePosition;
uniform bool isMouseInCanvas;
uniform float brushSizeInPixel;
uniform float planeID;
uniform vec3 addressSpaceDimensions;
uniform vec4 hoveredSegmentIdLow;
uniform vec4 hoveredSegmentIdHigh;

// For some reason, taking the dataset scale from the uniform results in imprecise
// rendering of the brush circle (and issues in the arbitrary modes). That's why it
// is directly inserted into the source via templating.
const vec3 datasetScale = <%= formatVector3AsVec3(datasetScale) %>;

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
in vec3 tpsOffsetXYZ;

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
  hasSegmentation ? getSegmentationId : null,
  hasSegmentation ? getCrossHairOverlay : null,
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

      vec3 transformedCoordUVW = transDim((<%= name %>_transform * vec4(transDim(worldCoordUVW), 1.0)).xyz);

      <% if (layerIndex == 0) { %>
      bool use_tps = true;
      if (use_tps) {
        transformedCoordUVW = worldCoordUVW;
        transformedCoordUVW += transDim(tpsOffsetXYZ);
      }
      <% } %>

      if (!isOutsideOfBoundingBox(transformedCoordUVW)) {
        MaybeFilteredColor maybe_filtered_color =
          getMaybeFilteredColorOrFallback(
            <%= formatNumberAsGLSLFloat(layerIndex) %>,
            <%= name %>_data_texture_width,
            <%= formatNumberAsGLSLFloat(textureLayerInfos[name].packingDegree) %>,
            transformedCoordUVW,
            false,
            fallbackGray,
            !<%= name %>_has_transform
          );
        bool used_fallback = maybe_filtered_color.used_fallback_color;
        color_value = maybe_filtered_color.color.rgb;
        <% if (textureLayerInfos[name].packingDegree === 2.0) { %>
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
        data_color.rgb,
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
out vec4 modelCoord;
out vec2 vUv;
out mat4 savedModelMatrix;
out vec3 tpsOffsetXYZ;

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
  hasSegmentation ? getSegmentationId : null,
  getResolution,
)}

float PLANE_WIDTH = ${formatNumberAsGLSLFloat(Constants.VIEWPORT_WIDTH)};
float PLANE_SUBDIVISION = ${formatNumberAsGLSLFloat(PLANE_SUBDIVISION)};

float REGULARIZATION = 1.;

const int CPS_LENGTH = 25;
vec3 W[CPS_LENGTH];
vec3 a[4];
vec3 cps[CPS_LENGTH];

void initializeArrays() {
  W[0] = vec3(-8.998658089073851e-05, -0.00015758524981576523, 0.00021841113415825152);
  W[1] = vec3(0.0005064263081459104, -0.00015328635076332367, -0.0009228703705533617);
  W[2] = vec3(-0.0005558847323333129, -0.00039761371579486056, 0.000555885624092427);
  W[3] = vec3(-0.000561612470923323, 0.0011376217766549015, -0.0010576816956660243);
  W[4] = vec3(-0.00014119132630760746, -0.0005372864332097236, 0.0001050268480774306);
  W[5] = vec3(-0.00016896987042403828, -3.605975747897271e-07, 0.00037769476775858255);
  W[6] = vec3(1.962423038209959e-05, 0.0005764729343091493, -0.0001117907017340755);
  W[7] = vec3(-1.4983989702070715e-05, -0.0002443712111554874, -9.988538630671101e-05);
  W[8] = vec3(0.000515632541810365, 0.00046987179732420445, -0.0006461927369505236);
  W[9] = vec3(-0.0008079916595018829, -0.0007994776207322017, 0.00011098542526017557);
  W[10] = vec3(-0.0009671999352523547, 2.829036403487725e-05, -0.0014190080339598517);
  W[11] = vec3(0.0007810388987982691, 8.474729405950904e-05, 0.0010312734320473);
  W[12] = vec3(0.001117804644442454, -0.0006856320990004658, 0.0015333863922644482);
  W[13] = vec3(0.0004343572056641483, 0.0006159294810164234, -0.0002963230330562254);
  W[14] = vec3(8.337713752338076e-05, 4.2739229264405195e-05, 0.0001417629613844372);
  W[15] = vec3(-0.00015970592920291362, -0.0008594063767764274, 0.0008275876527462828);
  W[16] = vec3(4.4542125646770664e-07, 0.0006834232559866387, -0.0004523927379710949);
  W[17] = vec3(-0.000877423334890741, -0.000629163386976586, -4.091976068813416e-05);
  W[18] = vec3(-0.00036239077928659855, -1.6860094473026683e-05, -0.00012335013049659708);
  W[19] = vec3(0.0011445439422526592, -0.00015481172687391976, 0.0007156735115566256);
  W[20] = vec3(0.0003059845585018402, 0.00012220036328674982, -0.0001770363893940523);
  W[21] = vec3(5.254902805105488e-05, 6.0111861109343954e-05, -0.0008263649809394509);
  W[22] = vec3(0.0008566755383619621, 0.0006035062081220003, 0.00020980916410153733);
  W[23] = vec3(0.00011705426704679713, 0.00010533605578980176, 0.00016859940084579692);
  W[24] = vec3(-0.0012281731135218273, 0.00010560424218857415, 0.00017771964342280742);
  cps[0] = vec3(570.3021, 404.5549, 502.22482);
  cps[1] = vec3(590.14484, 420.83395, 381.38028);
  cps[2] = vec3(568.84625, 435.02493, 325.98584);
  cps[3] = vec3(466.42474, 536.3788, 49.825325);
  cps[4] = vec3(489.5162, 587.5367, 77.7456);
  cps[5] = vec3(542.19104, 386.539, 370.47348);
  cps[6] = vec3(606.9088, 538.70386, 391.91803);
  cps[7] = vec3(469.87357, 503.2733, 550.86304);
  cps[8] = vec3(498.81058, 498.73495, 303.2482);
  cps[9] = vec3(459.70792, 531.0153, 237.093);
  cps[10] = vec3(355.25748, 483.12823, 193.33702);
  cps[11] = vec3(357.17856, 463.15057, 252.12674);
  cps[12] = vec3(444.25632, 527.81744, 80.380684);
  cps[13] = vec3(512.92175, 551.4335, 242.68991);
  cps[14] = vec3(430.49844, 455.07974, 213.30023);
  cps[15] = vec3(540.8051, 547.6318, 372.91214);
  cps[16] = vec3(501.69583, 485.92743, 412.7299);
  cps[17] = vec3(591.9243, 387.41516, 596.0109);
  cps[18] = vec3(584.1567, 504.25836, 535.5068);
  cps[19] = vec3(504.58694, 491.88492, 617.18726);
  cps[20] = vec3(542.1311, 558.4877, 636.365);
  cps[21] = vec3(515.8947, 450.044, 635.66614);
  cps[22] = vec3(553.48193, 372.3438, 584.3894);
  cps[23] = vec3(638.3767, 514.9311, 572.287);
  cps[24] = vec3(482.11002, 492.8521, 633.5717);
  a[0] = vec3(-5953.330171551693, 5813.318821780407, 8238.949423385715);
  a[1] = vec3(1.4351040831840678, -12.151744434539987, -1.195893460531354);
  a[2] = vec3(12.141764446272159, 1.1890762619351827, 0.8374945621633504);
  a[3] = vec3(0.613406767362934, 1.2490487526375056, -13.349651833018369);
}













 void main() {
  initializeArrays();

  vUv = uv;
  modelCoord = vec4(position, 1.0);
  savedModelMatrix = modelMatrix;
  worldCoord = modelMatrix * vec4(position, 1.0);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Remember the original z position, since it can subtly diverge in the
  // following calculations due to floating point inaccuracies. This can
  // result in artifacts, such as the crosshair disappearing.
  float originalZ = gl_Position.z;

  // Remember, the top of the viewport has Y=1 whereas the left has X=-1.
  vec3 worldCoordTopLeft     = transDim((modelMatrix * vec4(-PLANE_WIDTH/2.,  PLANE_WIDTH/2., 0., 1.)).xyz);
  vec3 worldCoordBottomRight = transDim((modelMatrix * vec4( PLANE_WIDTH/2., -PLANE_WIDTH/2., 0., 1.)).xyz);

  // The following code ensures that the vertices are aligned with the bucket borders
  // of the currently rendered magnification.
  // In general, an index i is computed for each vertex so that each vertex can be moved
  // to the right/bottom border of the i-th bucket.
  // Exceptions are the first and the last vertex which aren't moved so that the plane
  // keeps its original extent.

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

  // d is the width/height of a bucket in the current resolution.
  vec2 d = transDim(vec3(bucketWidth) * representativeMagForVertexAlignment).xy;

  vec3 datasetScaleUVW = transDim(datasetScale);
  vec3 transWorldCoord = transDim(worldCoord.xyz);

  if (index.x >= 1. && index.x <= PLANE_SUBDIVISION - 1.) {
    transWorldCoord.x =
      (
        // Left border of left-most bucket (probably outside of visible plane)
        floor(worldCoordTopLeft.x / datasetScaleUVW.x / d.x) * d.x
        // Move by index.x buckets to the right.
        + index.x * d.x
      ) * datasetScaleUVW.x;

    transWorldCoord.x = clamp(transWorldCoord.x, worldCoordTopLeft.x, worldCoordBottomRight.x);
  }

  if (index.y >= 1. && index.y <= PLANE_SUBDIVISION - 1.) {
    transWorldCoord.y =
      (
        // Top border of top-most bucket (probably outside of visible plane)
        floor(worldCoordTopLeft.y / datasetScaleUVW.y / d.y) * d.y
        // Move by index.y buckets to the bottom.
        + index.y * d.y
      ) * datasetScaleUVW.y;
    transWorldCoord.y = clamp(transWorldCoord.y, worldCoordTopLeft.y, worldCoordBottomRight.y);
  }

  worldCoord = vec4(transDim(transWorldCoord), 1.);

  gl_Position = projectionMatrix * viewMatrix * worldCoord;
  if (!is3DViewBeingRendered) {
    gl_Position.z = originalZ;
  }

  vec3 worldCoordUVW = getWorldCoordUVW();

  vec3 originalWorldCoord = transDim(vec3(transWorldCoord.x, transWorldCoord.y, worldCoordUVW.z));

  float x = originalWorldCoord.x;
  float y = originalWorldCoord.y;
  float z = originalWorldCoord.z;

  // transform the coord

  vec3 linear_part = a[0] + x * a[1] + y * a[2] + z * a[3];
  vec3 bending_part = vec3(0.0);

  for (int cpIdx = 0; cpIdx < CPS_LENGTH; cpIdx++) {
    // Calculate distance to each control point
    float el = sqrt(
      pow(x - cps[cpIdx].x, 2.0) +
      pow(y - cps[cpIdx].y, 2.0) +
      pow(z - cps[cpIdx].z, 2.0)
    );

    if (el != 0.0) {
      el = pow(el, 2.0) * log2(pow(el, 2.0)) / log2(2.718281828459045);
    } else {
      el = REGULARIZATION;
    }
    bending_part += el * W[cpIdx];
  }

  tpsOffsetXYZ = linear_part + bending_part;
  // Adapt to z scaling if necessary
  // tpsOffsetXYZ.z /= 100.;


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
  });
}
