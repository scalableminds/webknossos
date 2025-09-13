import _ from "lodash";
import type { ElementClass } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { formatNumberAsGLSLFloat, glslTypeForElementClass } from "./utils.glsl";

export interface LayerShaderParams {
  layerName: string;
  sanitizedLayerName: string;
  elementClass: ElementClass;
  packingDegree: number;
  isColor: boolean;
  isSegmentation: boolean;
  layerIndex: number;
  dataTextureCount: number;
  isSigned: boolean;
  glslPrefix: string;
  hasTransform: boolean;
  hasTpsTransform: boolean;
}

export class ColorLayerShader {
  constructor(private params: LayerShaderParams) {}

  getUniforms(): string {
    const { sanitizedLayerName, elementClass } = this.params;
    return `
uniform highp ${this.params.glslPrefix}sampler2D ${sanitizedLayerName}_textures[${this.params.dataTextureCount}];
uniform float ${sanitizedLayerName}_data_texture_width;
uniform float ${sanitizedLayerName}_alpha;
uniform float ${sanitizedLayerName}_gammaCorrectionValue;
uniform float ${sanitizedLayerName}_unrenderable;
uniform mat4 ${sanitizedLayerName}_transform;
uniform bool ${sanitizedLayerName}_has_transform;
uniform vec3 ${sanitizedLayerName}_color;
uniform ${glslTypeForElementClass(elementClass)} ${sanitizedLayerName}_min;
uniform ${glslTypeForElementClass(elementClass)} ${sanitizedLayerName}_max;
uniform float ${sanitizedLayerName}_is_inverted;
`;
  }

  getFragmentShaderCode(): string {
    const { sanitizedLayerName, elementClass, packingDegree, layerIndex } = this.params;
    
    return `
// Color processing for layer: ${this.params.layerName}
vec4 processLayer_${sanitizedLayerName}(vec3 worldCoordUVW, vec4 currentColor) {
  float ${sanitizedLayerName}_effective_alpha = ${sanitizedLayerName}_alpha * (1. - ${sanitizedLayerName}_unrenderable);
  
  if (${sanitizedLayerName}_effective_alpha <= 0.) {
    return currentColor;
  }

  ${this.params.hasTpsTransform ? 
    `vec3 transformedCoordUVW = worldCoordUVW + transDim(tpsOffsetXYZ_${sanitizedLayerName});` :
    `vec3 transformedCoordUVW = transDim((${sanitizedLayerName}_transform * vec4(transDim(worldCoordUVW), 1.0)).xyz);`
  }

  if (isOutsideOfBoundingBox(transformedCoordUVW)) {
    return currentColor;
  }

  MaybeFilteredColor maybe_filtered_color = getMaybeFilteredColorOrFallback(
    ${formatNumberAsGLSLFloat(layerIndex)},
    ${sanitizedLayerName}_data_texture_width,
    ${formatNumberAsGLSLFloat(packingDegree)},
    transformedCoordUVW,
    false,
    fallbackGray,
    !${sanitizedLayerName}_has_transform
  );

  bool used_fallback = maybe_filtered_color.used_fallback_color;
  float is_max_and_min_equal = float(${sanitizedLayerName}_max == ${sanitizedLayerName}_min);

  vec3 color_value = maybe_filtered_color.color.rgb;

  ${this.getElementClassProcessing()}

  color_value = pow(color_value, 1. / vec3(${sanitizedLayerName}_gammaCorrectionValue));
  color_value = abs(color_value - ${sanitizedLayerName}_is_inverted);
  color_value = mix(color_value, vec3(0.0), is_max_and_min_equal);
  color_value = color_value * ${sanitizedLayerName}_alpha * ${sanitizedLayerName}_color;

  vec4 layer_color = vec4(color_value, used_fallback ? 0.0 : maybe_filtered_color.color.a * ${sanitizedLayerName}_alpha);
  
  vec4 additive_color = blendLayersAdditive(currentColor, layer_color);
  vec4 cover_color = blendLayersCover(currentColor, layer_color, used_fallback);
  
  return mix(cover_color, additive_color, float(blendMode == 1.0));
}
`;
  }

  private getElementClassProcessing(): string {
    const { sanitizedLayerName, elementClass } = this.params;
    
    if (elementClass.endsWith("int32")) {
      if (elementClass === "int32") {
        return `
  ivec4 four_bytes = ivec4(255. * maybe_filtered_color.color);
  highp int hpv = four_bytes.r | (four_bytes.g << 8) | (four_bytes.b << 16) | (four_bytes.a << 24);
  int min = ${sanitizedLayerName}_min;
  int max = ${sanitizedLayerName}_max;
  hpv = clamp(hpv, min, max);
  color_value = vec3(scaleIntToFloat(hpv, min, max));
`;
      } else {
        return `
  uvec4 four_bytes = uvec4(255. * maybe_filtered_color.color);
  highp uint hpv = uint(four_bytes.a) * uint(pow(256., 3.)) + uint(four_bytes.b) * uint(pow(256., 2.)) + uint(four_bytes.g) * 256u + uint(four_bytes.r);
  uint min = ${sanitizedLayerName}_min;
  uint max = ${sanitizedLayerName}_max;
  hpv = clamp(hpv, min, max);
  color_value = vec3(float(hpv - min) / (float(max - min) + is_max_and_min_equal));
`;
      }
    } else {
      return `
  ${elementClass === "uint24" ? "color_value *= 255.;" : "color_value = vec3(color_value.x);"}
  color_value = clamp(color_value, ${sanitizedLayerName}_min, ${sanitizedLayerName}_max);
  color_value = vec3(scaleFloatToFloat(color_value, ${sanitizedLayerName}_min, ${sanitizedLayerName}_max));
`;
    }
  }
}

export class SegmentationLayerShader {
  constructor(private params: LayerShaderParams) {}

  getUniforms(): string {
    const { sanitizedLayerName } = this.params;
    return `
uniform highp ${this.params.glslPrefix}sampler2D ${sanitizedLayerName}_textures[${this.params.dataTextureCount}];
uniform float ${sanitizedLayerName}_data_texture_width;
uniform float ${sanitizedLayerName}_alpha;
uniform float ${sanitizedLayerName}_gammaCorrectionValue;
uniform float ${sanitizedLayerName}_unrenderable;
uniform mat4 ${sanitizedLayerName}_transform;
uniform bool ${sanitizedLayerName}_has_transform;
`;
  }

  getFragmentShaderCode(): string {
    const { sanitizedLayerName, elementClass } = this.params;
    
    const vec4ToSomeIntFn = elementClass.endsWith("int64")
      ? (this.params.isSigned ? "int64ToUint64" : "uint64ToUint64")
      : (this.params.isSigned ? "int32ToUint64" : "uint32ToUint64");

    return `
// Segmentation processing for layer: ${this.params.layerName}
vec4 processSegmentationLayer_${sanitizedLayerName}(vec3 worldCoordUVW, vec4 currentColor) {
  uint ${sanitizedLayerName}_id_low = 0u;
  uint ${sanitizedLayerName}_id_high = 0u;
  uint ${sanitizedLayerName}_unmapped_id_low = 0u;
  uint ${sanitizedLayerName}_unmapped_id_high = 0u;
  float ${sanitizedLayerName}_effective_alpha = ${sanitizedLayerName}_alpha * (1. - ${sanitizedLayerName}_unrenderable);

  if (${sanitizedLayerName}_effective_alpha <= 0.) {
    return currentColor;
  }

  vec4[2] unmapped_segment_id;
  vec4[2] segment_id;
  getSegmentId_${sanitizedLayerName}(worldCoordUVW, unmapped_segment_id, segment_id);

  highp uint hpv_low;
  highp uint hpv_high;

  ${vec4ToSomeIntFn}(unmapped_segment_id[1], unmapped_segment_id[0], hpv_low, hpv_high);
  ${sanitizedLayerName}_unmapped_id_low = uint(hpv_low);
  ${sanitizedLayerName}_unmapped_id_high = uint(hpv_high);

  ${vec4ToSomeIntFn}(segment_id[1], segment_id[0], hpv_low, hpv_high);
  ${sanitizedLayerName}_id_low = uint(hpv_low);
  ${sanitizedLayerName}_id_high = uint(hpv_high);

  vec4 result = currentColor;

  if (${sanitizedLayerName}_id_low != 0u || ${sanitizedLayerName}_id_high != 0u) {
    bool isHoveredSegment = hoveredSegmentIdLow == ${sanitizedLayerName}_id_low && hoveredSegmentIdHigh == ${sanitizedLayerName}_id_high;
    bool isHoveredUnmappedSegment = hoveredUnmappedSegmentIdLow == ${sanitizedLayerName}_unmapped_id_low && hoveredUnmappedSegmentIdHigh == ${sanitizedLayerName}_unmapped_id_high;
    bool isActiveCell = activeCellIdLow == ${sanitizedLayerName}_id_low && activeCellIdHigh == ${sanitizedLayerName}_id_high;
    
    float alphaIncrement = getSegmentationAlphaIncrement(
      ${sanitizedLayerName}_alpha,
      isHoveredSegment,
      isHoveredUnmappedSegment,
      isActiveCell
    );

    vec4 segmentColor = convertCellIdToRGB(${sanitizedLayerName}_id_high, ${sanitizedLayerName}_id_low);
    result = vec4(mix(
      currentColor.rgb,
      segmentColor.rgb,
      ${sanitizedLayerName}_alpha * segmentColor.a + alphaIncrement
    ), 1.0);
  }

  vec4 ${sanitizedLayerName}_brushOverlayColor = getBrushOverlay(worldCoordUVW);
  ${sanitizedLayerName}_brushOverlayColor.xyz = convertCellIdToRGB(activeCellIdHigh, activeCellIdLow).rgb;
  result = mix(result, ${sanitizedLayerName}_brushOverlayColor, ${sanitizedLayerName}_brushOverlayColor.a);
  result.a = 1.0;

  return result;
}
`;
  }
}

export function generateLayerShaderFunction(params: LayerShaderParams): string {
  if (params.isSegmentation) {
    const shader = new SegmentationLayerShader(params);
    return shader.getFragmentShaderCode();
  } else {
    const shader = new ColorLayerShader(params);
    return shader.getFragmentShaderCode();
  }
}

export function generateLayerUniforms(params: LayerShaderParams): string {
  if (params.isSegmentation) {
    const shader = new SegmentationLayerShader(params);
    return shader.getUniforms();
  } else {
    const shader = new ColorLayerShader(params);
    return shader.getUniforms();
  }
}