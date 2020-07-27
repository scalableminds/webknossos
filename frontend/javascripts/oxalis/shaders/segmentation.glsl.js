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
      The "permutation" is generated using a seed which should be tested manually
      to ensure a good-enough permutation.

      To achieve a diverse combination with little collisions, multiple, dependent
      usages of getElementOfPermutation should use a sequenceLength which is prime
      and unique. Refer to this super-dirty code when in need:
        https://gist.github.com/philippotto/88487cddcff049c2aac70b69041efacf

      Seeds should be tested manually to guarantee a good permutation for
      a specific sequenceLength.

      Good seeds for different sequenceLengths are:
      sequenceLength=13.0, seed=0.618033988749895) --> "Perfect" permutation
      sequenceLength=17.0, seed=1.41421            --> "Perfect" permutation
      sequenceLength=19.0, seed=0.618033988749895  --> 1 collision (Utilization 94.74%)
    */
    float getElementOfPermutation(float index, float sequenceLength, float seed) {
      // The index should not be modded with the sequenceLength if one wants to
      // better utilize an index domain which is larger than sequenceLength.
      float oneBasedIndex = index + 1.0;
      float fraction = mod(oneBasedIndex * seed, 1.0);
      return ceil(fraction * sequenceLength);
    }

    vec3 convertCellIdToRGB(vec4 id) {
      float golden_ratio = 0.618033988749895;
      float lastEightBits = id.r;
      float significantSegmentIndex = 256.0 * id.g + id.r;

      float colorCount = 17.;
      float colorSeed = 1.41421;
      float colorIndex = getElementOfPermutation(significantSegmentIndex, colorCount, colorSeed);
      float colorValue = 1.0 / colorCount * colorIndex;
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
      // zoomStep compensates this.
      float coordScaling = 0.25 * mix(1., 2., mod(significantSegmentIndex, 2.));
      vec3 worldCoordUVW = coordScaling * getWorldCoordUVW()  / (zoomStep + 1.0);

      float baseVoxelSize = min(min(datasetScale.x, datasetScale.y), datasetScale.z);
      vec3 datasetScaleUVW = transDim(datasetScale) / baseVoxelSize;
      worldCoordUVW.x = worldCoordUVW.x * datasetScaleUVW.x;
      worldCoordUVW.y = worldCoordUVW.y * datasetScaleUVW.y;

      float angleCount = 19.;
      float angleSeed = 0.618033988749895;
      float angle = 1.0 / angleCount * getElementOfPermutation(significantSegmentIndex, angleCount, angleSeed);

      float stripe_value_a = mix(
        worldCoordUVW.x,
        worldCoordUVW.y,
        angle
      );
      float stripe_value_b = mix(
        worldCoordUVW.x,
        -worldCoordUVW.y,
        1.0 - angle
      );
      float use_grid = step(mod(significantSegmentIndex * 1.81893, 1.0), 0.5);
      float aa_stripe_value_a = aa_step(stripe_value_a);
      float aa_stripe_value_b = aa_step(stripe_value_b);
      float aa_stripe_value = 1.0 - max(aa_stripe_value_a, use_grid * aa_stripe_value_b);

      vec4 HSV = vec4(
        colorValue,
        1.0 - 0.5 * ((1. - aa_stripe_value) * segmentationPatternOpacity / 100.0),
        1.0 - 0.5 * (aa_stripe_value * segmentationPatternOpacity / 100.0),
        1.0
      );

      return hsvToRgb(HSV).xyz;
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
