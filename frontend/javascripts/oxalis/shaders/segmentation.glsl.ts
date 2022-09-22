import {
  hsvToRgb,
  jsRgb2hsv,
  getElementOfPermutation,
  jsGetElementOfPermutation,
  aaStep,
  colormapJet,
  jsColormapJet,
} from "oxalis/shaders/utils.glsl";
import { Vector4 } from "oxalis/constants";
import type { ShaderModule } from "./shader_module_system";
import { binarySearchIndex } from "./mappings.glsl";
import { getRgbaAtIndex } from "./texture_access.glsl";
export const convertCellIdToRGB: ShaderModule = {
  requirements: [hsvToRgb, getRgbaAtIndex, getElementOfPermutation, aaStep, colormapJet],
  code: `
    highp uint hashCombine(highp uint state, highp uint value) {
      // The used constants are written in decimal, because
      // the parser tests don't support unsigned int hex notation
      // (yet).
      // See this issue: https://github.com/ShaderFrog/glsl-parser/issues/1
      // 3432918353u == 0xcc9e2d51u
      //  461845907u == 0x1b873593u
      // 3864292196u == 0xe6546b64u

      value *= 3432918353u;
      value = (value << 15u) | (value >> 17u);
      value *= 461845907u;
      state ^= value;
      state = (state << 13u) | (state >> 19u);
      state = (state * 5u) + 3864292196u;
      return state;
    }

    uint vec4ToUint(vec4 idLow) {
      uint integerValue = (uint(idLow.a) << 24) | (uint(idLow.b) << 16) | (uint(idLow.g) << 8) | uint(idLow.r);
      return integerValue;
    }

    vec3 attemptCustomColorLookUp(uint integerValue, uint seed) {
      highp uint h0 = hashCombine(seed, integerValue) % CUCKOO_ENTRY_CAPACITY;
      h0 = uint(h0 * CUCKOO_ELEMENTS_PER_ENTRY / CUCKOO_ELEMENTS_PER_TEXEL);
      highp uint x = h0 % CUCKOO_TWIDTH;
      highp uint y = h0 / CUCKOO_TWIDTH;

      uvec4 customEntry = texelFetch(custom_color_texture, ivec2(x, y), 0);
      uvec3 customColor = customEntry.gba;

      if (customEntry.r != uint(integerValue)) {
         return vec3(-1);
      }

      return vec3(customEntry.gba) / 255.;
    }


    vec3 convertCellIdToRGB(vec4 idHigh, vec4 idLow) {
      /*
      This function maps from a segment id to a color with a pattern.
      For the color, the jet color map is used. For the patterns, we employ the following
      features:
      - different shapes (stripes and grid)
      - different angles
      - different densities (see frequencyModulator)

      The features are pseudo-randomly combined using getElementOfPermutation.
      This approach gives us 19 colors  * 2 shapes * 17 angles * 3 densities and therefore
      1938 different segment styles.

      If custom colors were provided via mappings, the color values are used from there.
      The patterns are still painted on top of these, though.
      */

      // Since collisions of ids are bound to happen, using all 64 bits is not
      // necessary, which is why we simply combine the 32-bit tuple into one 32-bit value.
      vec4 id = idHigh + idLow;
      float significantSegmentIndex = 256.0 * id.g + id.r;

      float colorCount = 19.;
      float colorIndex = getElementOfPermutation(significantSegmentIndex, colorCount, 2.);
      float colorValueDecimal = 1.0 / colorCount * colorIndex;
      float colorHue = rgb2hsv(colormapJet(colorValueDecimal)).x;
      float colorSaturation = 1.;
      float colorValue = 1.;
      // For historical reference: the old color generation was:
      // float lastEightBits = id.r;
      // float colorHue = mod(lastEightBits * (golden_ratio - 1.0), 1.0);

      uint integerValue = vec4ToUint(idLow);
      vec3 customColor = attemptCustomColorLookUp(integerValue, seed0);
      if (customColor.r == -1.) {
        customColor = attemptCustomColorLookUp(integerValue, seed1);
      }
      if (customColor.r == -1.) {
        customColor = attemptCustomColorLookUp(integerValue, seed2);
      }
      if (customColor.r != -1.) {
        vec3 customHSV = rgb2hsv(customColor);
        colorHue = customHSV.x;
        colorSaturation = customHSV.y;
        colorValue = customHSV.z;
      }

      // The following code scales the world coordinates so that the coordinate frequency is in a "pleasant" range.
      // Also, when zooming out, coordinates change faster which make the pattern more turbulent. Dividing by the
      // zoomValue compensates this. Note that the zoom *step* should not be used here, because that value relates to the
      // three-dimensional dataset. Since the patterns are only 2D, the zoomValue is a better proxy.
      //
      // By default, scale everything with fineTunedScale as this seemed a good value during testing.
      float fineTunedScale = 0.15;
      // Additionally, apply another scale factor (between 0.5 and 1.5) depending on the segment id.
      float frequencySequenceLength = 3.;
      float frequencyModulator = mix(0.5, 1.5, getElementOfPermutation(significantSegmentIndex, frequencySequenceLength, 2.) / frequencySequenceLength);
      float coordScaling = fineTunedScale * frequencyModulator;
      // Round the zoomValue so that the pattern frequency only changes at distinct steps. Otherwise, zooming out
      // wouldn't change the pattern at all, which would feel weird.
      float zoomAdaption = ceil(zoomValue);
      vec3 worldCoordUVW = coordScaling * getWorldCoordUVW()  / zoomAdaption;

      float baseVoxelSize = min(min(datasetScale.x, datasetScale.y), datasetScale.z);
      vec3 datasetScaleUVW = transDim(datasetScale) / baseVoxelSize;
      worldCoordUVW.x = worldCoordUVW.x * datasetScaleUVW.x;
      worldCoordUVW.y = worldCoordUVW.y * datasetScaleUVW.y;

      float angleCount = 17.;
      float angle = 1.0 / angleCount * getElementOfPermutation(significantSegmentIndex, angleCount, 3.0);

      // To produce a stripe or grid pattern, we use the current fragment coordinates
      // and an angle.
      // stripeValueA is a value between 0 and 1 which - when rounded - denotes if the current fragment
      // is in the "bright" or "dark" stripe class.
      // Similarly, stripeValueB is constructed, with the difference that the angle is orthogonal to
      // stripeValueA.
      // When combining both stripe values, a grid can be produced. When only using stripeValueA, a simple
      // stripe pattern is rendered.
      float stripeValueA = mix(
        worldCoordUVW.x,
        worldCoordUVW.y,
        angle
      );
      float stripeValueB = mix(
        worldCoordUVW.x,
        -worldCoordUVW.y,
        1.0 - angle
      );

      // useGrid is binary, but we generate a pseudo-random sequence of 13 elements which we map
      // to ones and zeros. This has the benefit that the periodicity has a prime length.
      float useGridSequenceLength = 13.;
      float useGrid = step(mod(getElementOfPermutation(significantSegmentIndex, useGridSequenceLength, 2.0), 2.0), 0.5);
      // Cast the continuous stripe values to 0 and 1 + a bit of anti-aliasing.
      float aaStripeValueA = aaStep(stripeValueA);
      float aaStripeValueB = aaStep(stripeValueB);
      // Combine both stripe values when a grid should be rendered. Otherwise, only use aaStripeValueA
      float aaStripeValue = 1.0 - max(aaStripeValueA, useGrid * aaStripeValueB);

      vec4 HSV = vec4(
        colorHue,
        colorSaturation - 0.5 * ((1. - aaStripeValue) * segmentationPatternOpacity / 100.0),
        colorValue - 0.5 * (aaStripeValue * segmentationPatternOpacity / 100.0),
        1.0
      );

      return hsvToRgb(HSV);
    }
  `,
};
// This function mirrors the above convertCellIdToRGB-function.
// Output is in [0,1] for H, S, L and A
export const jsConvertCellIdToHSLA = (
  id: number,
  customColors?: Array<number> | null | undefined,
  alpha: number = 1,
): Vector4 => {
  if (id === 0) {
    // Return white
    return [1, 1, 1, 1];
  }

  let hue;

  if (customColors != null) {
    const last8Bits = id % 2 ** 8;
    hue = customColors[last8Bits] || 0;
  } else {
    // The shader always derives the segment color by using a 64-bit id from which
    // - the lower 16 bits of the lower 32 bits and
    // - the lower 16 bits of the upper 32 bits
    // are used to derive the color.
    // In JS, we do it similarly:
    const bigId = BigInt(id);
    const highPart = Number((bigId >> 32n) % 2n ** 16n);
    const lowPart = id % 2 ** 16;
    const significantSegmentIndex = highPart + lowPart;
    const colorCount = 19;
    const colorIndex = jsGetElementOfPermutation(significantSegmentIndex, colorCount, 2);
    const colorValueDecimal = (1.0 / colorCount) * colorIndex;
    hue = (1 / 360) * jsRgb2hsv(jsColormapJet(colorValueDecimal))[0];
  }

  return [hue, 1, 0.5, alpha];
};
export const getBrushOverlay: ShaderModule = {
  code: `
    vec4 getBrushOverlay(vec3 worldCoordUVW) {
      vec4 brushOverlayColor = vec4(0.0);

      if (!isMouseInCanvas || !isMouseInActiveViewport || !showBrush) {
        return brushOverlayColor;
      }
      vec3 flooredMousePos = floor(globalMousePosition);
      float baseVoxelSize = min(min(datasetScale.x, datasetScale.y), datasetScale.z);
      vec3 datasetScaleUVW = transDim(datasetScale) / baseVoxelSize;

      float dist = length((floor(worldCoordUVW.xy) - transDim(flooredMousePos).xy) * datasetScaleUVW.xy);

      float radius = round(brushSizeInPixel / 2.0);
      if (radius > dist) {
        brushOverlayColor = vec4(vec3(1.0), 0.5);
      }

      return brushOverlayColor;
    }
  `,
};
export const getSegmentationId: ShaderModule = {
  requirements: [binarySearchIndex, getRgbaAtIndex],
  code: `

  <% _.each(segmentationLayerNames, function(segmentationName, layerIndex) { %>
    vec4[2] getSegmentationId_<%= segmentationName %>(vec3 worldPositionUVW) {
      vec4[2] volume_color =
        getSegmentIdOrFallback(
          <%= segmentationName %>_lookup_texture,
          <%= formatNumberAsGLSLFloat(colorLayerNames.length + layerIndex) %>,
          <%= segmentationName %>_data_texture_width,
          <%= formatNumberAsGLSLFloat(packingDegreeLookup[segmentationName]) %>,
          worldPositionUVW,
          vec4(0.0, 0.0, 0.0, 0.0)
        );

      // Depending on the packing degree, the returned volume color contains extra values
      // which should be ignored (in the binary search as well as when comparing
      // a cell id with the hovered cell passed via uniforms, for example).

      <% if (packingDegreeLookup[segmentationName] === 4) { %>
        volume_color[1] = vec4(volume_color[1].r, 0.0, 0.0, 0.0);
      <% } else if (packingDegreeLookup[segmentationName] === 2) { %>
        volume_color[1] = vec4(volume_color[1].r, volume_color[1].g, 0.0, 0.0);
      <% } %>

      if (isMappingEnabled) {
        // Note that currently only the lower 32 bits of the segmentation
        // are used for applying the JSON mapping.

        float index = binarySearchIndex(
          segmentation_mapping_lookup_texture,
          mappingSize,
          volume_color[1]
        );
        if (index != -1.0) {
          volume_color[1] = getRgbaAtIndex(
            segmentation_mapping_texture,
            <%= mappingTextureWidth %>,
            index
          );
        } else if (hideUnmappedIds) {
          volume_color[1] = vec4(0.0);
        }
      }

      volume_color[0] *= 255.0;
      volume_color[1] *= 255.0;
      return volume_color;
    }
<% }) %>
  `,
};
