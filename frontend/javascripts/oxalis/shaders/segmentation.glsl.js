// @flow
import type { ShaderModule } from "./shader_module_system";
import { binarySearchIndex } from "./mappings.glsl";
import { getRgbaAtIndex } from "./texture_access.glsl";
import { hsvToRgb } from "./utils.glsl";

export const convertCellIdToRGB: ShaderModule = {
  requirements: [hsvToRgb, getRgbaAtIndex],
  code: `

    /*
      Antialiased step function.
      Parameter x must not be discontinuous

      See: https://www.shadertoy.com/view/wtjGzt
    */
    float aa_step(float x) {
        float w = fwidth(x);    // pixel width
        return smoothstep(.7, -.7, (abs(fract(x - .25) - .5) - .25) / w);
    }

    /*
      getElementOfPermutation produces a poor-man's permutation of the numbers
      [1, ..., sequenceLength] and returns the index-th element.
      The "permutation" is generated using primitive roots.
      Example:
        When calling
          getElementOfPermutation(3, 7, 3)
        an implicit sequence of
          7, 2, 6, 4, 5, 1, 3
        is accessed at index 3 to return a value.
        Thus, 4 is returned.

      Additional explanation:
      3 is a primitive root modulo 7. This fact can be used to generate
      the following pseudo-random sequence by calculating
      primitiveRoot**index % sequenceLength:
      3, 2, 6, 4, 5, 1, 3
      (see https://en.wikipedia.org/wiki/Primitive_root_modulo_n for a more
      in-depth explanation).
      Since the above sequence contains 7 elements (as requested), but exactly *one*
      collision (the first and last elements will always be the same), we swap the
      first element with 7.

      To achieve a diverse combination with little collisions, multiple, dependent
      usages of getElementOfPermutation should use unique sequenceLength values
      which are prime. You can check out this super-dirty code to double-check
      collisions:
        https://gist.github.com/philippotto/88487cddcff049c2aac70b69041efacf

      Sample primitiveRoots for different prime sequenceLengths are:
      sequenceLength=13.0, seed=2
      sequenceLength=17.0, seed=3
      sequenceLength=19.0, seed=2
      More primitive roots for different prime values can be looked up online.
    */
    float getElementOfPermutation(float index, float sequenceLength, float primitiveRoot) {
      float oneBasedIndex = mod(index, sequenceLength) + 1.0;
      // If oneBasedIndex == 1, isNotFirstElement == 0:
      float isNotFirstElement = step(1.5, oneBasedIndex);

      float sequenceValue = mod(pow(primitiveRoot, oneBasedIndex), sequenceLength);

      return
        // Only use sequenceLength if request element is not the first of the sequence
        isNotFirstElement * sequenceValue
        // Otherwise, return sequenceLength
        + (1. - isNotFirstElement) * sequenceLength;
    }

    vec3 colormapJet(float x) {
      vec3 result;
      result.r = x < 0.89 ? ((x - 0.35) / 0.31) : (1.0 - (x - 0.89) / 0.11 * 0.5);
      result.g = x < 0.64 ? ((x - 0.125) * 4.0) : (1.0 - (x - 0.64) / 0.27);
      result.b = x < 0.34 ? (0.5 + x * 0.5 / 0.11) : (1.0 - (x - 0.34) / 0.31);
      return clamp(result, 0.0, 1.0);
    }

    vec3 convertCellIdToRGB(vec4 id) {
      float golden_ratio = 0.618033988749895;
      float lastEightBits = id.r;
      float significantSegmentIndex = 256.0 * id.g + id.r;

      float colorCount = 17.;
      float colorIndex = getElementOfPermutation(significantSegmentIndex, colorCount, 3.);
      float colorValueDecimal = 1.0 / colorCount * colorIndex;
      float colorValue = rgb2hsv(colormapJet(colorValueDecimal)).x;
      // For historical reference: the old color generation was: colorValue = mod(lastEightBits * golden_ratio, 1.0);

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

      // Scale world coordinates for a pleasant coordinate frequency.
      // Also, when zooming out, coordinates change faster which make the pattern more turbulent. Dividing by the
      // zoomValue compensates this. Note that the zoomStep should not be used, because that value relates to the
      // three-dimensional dataset. Since the patterns are only 2D, the zoomValue is a better proxy.
      float finedTunedScale = 0.15;
      float frequencySequenceLength = 3.;
      float frequencyModulator = mix(0.5, 1.5, getElementOfPermutation(significantSegmentIndex, frequencySequenceLength, 2.) / frequencySequenceLength);
      float coordScaling = finedTunedScale * frequencyModulator;
      float zoomAdaption = ceil(zoomValue);
      vec3 worldCoordUVW = coordScaling * getWorldCoordUVW()  / zoomAdaption;


      float baseVoxelSize = min(min(datasetScale.x, datasetScale.y), datasetScale.z);
      vec3 datasetScaleUVW = transDim(datasetScale) / baseVoxelSize;
      worldCoordUVW.x = worldCoordUVW.x * datasetScaleUVW.x;
      worldCoordUVW.y = worldCoordUVW.y * datasetScaleUVW.y;

      float angleCount = 19.;
      float angle = 1.0 / angleCount * getElementOfPermutation(significantSegmentIndex, angleCount, 2.0);

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
      float aaStripeValueA = aa_step(stripeValueA);
      float aaStripeValueB = aa_step(stripeValueB);
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

export const getBrushOverlay: ShaderModule = {
  code: `
    vec4 getBrushOverlay(vec3 worldCoordUVW) {
      vec4 brushOverlayColor = vec4(0.0);
      bool isBrushModeActive = activeVolumeToolIndex == <%= brushToolIndex %>;

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


      <% if (isMappingSupported) { %>
        if (isMappingEnabled) {
          // Depending on the packing degree, the returned volume color contains extra values
          // which would make the binary search fail

          <% if (segmentationPackingDegree === "4.0") { %>
            volume_color = vec4(volume_color.r, 0.0, 0.0, 0.0);
          <% } else if (segmentationPackingDegree === "2.0") { %>
            volume_color = vec4(volume_color.r, volume_color.g, 0.0, 0.0);
          <% } %>

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
