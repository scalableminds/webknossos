// @flow
import type { ShaderModule } from "./shader_module_system";
import { binarySearchIndex } from "./mappings.glsl";
import { getRgbaAtIndex } from "./texture_access.glsl";
import {
  hsvToRgb,
  jsRgb2hsv,
  getElementOfPermutation,
  jsGetElementOfPermutation,
  aaStep,
  colormapJet,
  jsColormapJet,
} from "./utils.glsl";

export const convertCellIdToRGB: ShaderModule = {
  requirements: [hsvToRgb, getRgbaAtIndex, getElementOfPermutation, aaStep, colormapJet],
  code: `
    vec3 convertCellIdToRGB(vec4 id) {
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

      float lastEightBits = id.r;
      float significantSegmentIndex = 256.0 * id.g + id.r;

      float colorCount = 19.;
      float colorIndex = getElementOfPermutation(significantSegmentIndex, colorCount, 2.);
      float colorValueDecimal = 1.0 / colorCount * colorIndex;
      float colorValue = rgb2hsv(colormapJet(colorValueDecimal)).x;
      // For historical reference: the old color generation was: colorValue = mod(lastEightBits * (golden_ratio - 1.0), 1.0);

      <% if (isMappingSupported) { %>
        // If the first element of the mapping colors texture is still the initialized
        // colorValue of -1, no mapping colors have been specified
        bool hasCustomMappingColors = getRgbaAtIndex(
          <%= segmentationName %>_mapping_color_texture,
          <%= mappingColorTextureWidth %>,
          0.0
        ).r != -1.0;
        if (isMappingEnabled && hasCustomMappingColors) {
          colorValue = getRgbaAtIndex(
            <%= segmentationName %>_mapping_color_texture,
            <%= mappingColorTextureWidth %>,
            lastEightBits
          ).r;
        }
      <% } %>

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
        colorValue,
        1.0 - 0.5 * ((1. - aaStripeValue) * segmentationPatternOpacity / 100.0),
        1.0 - 0.5 * (aaStripeValue * segmentationPatternOpacity / 100.0),
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
  customColors?: ?Array<number>,
  alpha: number = 1,
): Array<number> => {
  if (id === 0) {
    // Return white
    return [1, 1, 1, 1];
  }

  let hue;

  if (customColors != null) {
    const last8Bits = id % 2 ** 8;
    hue = customColors[last8Bits] || 0;
  } else {
    const significantSegmentIndex = id % 2 ** 16;

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
      bool isBrushModeActive = activeAnnotationToolIndex == <%= brushToolIndex %>;

      if (!isMouseInCanvas || !isMouseInActiveViewport || !isBrushModeActive) {
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
    vec4 getSegmentationId(vec3 worldPositionUVW) {
      vec4 volume_color =
        getMaybeFilteredColorOrFallback(
          <%= segmentationName %>_lookup_texture,
          <%= formatNumberAsGLSLFloat(segmentationLayerIndex) %>,
          <%= segmentationName %>_data_texture_width,
          <%= segmentationPackingDegree %>,
          worldPositionUVW,
          true, // Don't use bilinear filtering for volume data
          vec4(0.0, 0.0, 0.0, 0.0)
        );

      // Depending on the packing degree, the returned volume color contains extra values
      // which would should be ignored (in the binary search as well as when comparing
      // a cell id with the hovered cell passed via uniforms, for example).

      <% if (segmentationPackingDegree === "4.0") { %>
        volume_color = vec4(volume_color.r, 0.0, 0.0, 0.0);
      <% } else if (segmentationPackingDegree === "2.0") { %>
        volume_color = vec4(volume_color.r, volume_color.g, 0.0, 0.0);
      <% } %>

      <% if (isMappingSupported) { %>
        if (isMappingEnabled) {

          float index = binarySearchIndex(
            <%= segmentationName %>_mapping_lookup_texture,
            mappingSize,
            volume_color
          );
          if (index != -1.0) {
            volume_color = getRgbaAtIndex(
              <%= segmentationName %>_mapping_texture,
              <%= mappingTextureWidth %>,
              index
            );
          } else if (hideUnmappedIds) {
            volume_color = vec4(0.0);
          }
        }
      <% } %>

      return volume_color * 255.0;
    }
  `,
};
