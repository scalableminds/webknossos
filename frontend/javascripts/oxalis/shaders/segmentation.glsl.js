// @flow
import type { ShaderModule } from "./shader_module_system";
import { binarySearchIndex } from "./mappings.glsl";
import { getRgbaAtIndex } from "./texture_access.glsl";
import { hsvToRgb } from "./utils.glsl";

export const convertCellIdToRGB: ShaderModule = {
  requirements: [hsvToRgb, getRgbaAtIndex],
  code: `

    // Antialiased step
    // See: https://www.shadertoy.com/view/wtjGzt
    float aa_step(float x) {     //
        float w = fwidth(x);    // pixel width. NB: x must not be discontinuous or factor discont out
        return smoothstep(.7,-.7,(abs(fract(x-.25)-.5)-.25)/w); // just use (offseted) smooth squares
    }

    float rand(vec2 co){
        return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453);
    }

    // Seeds should be tested manually to guarantee a good permutation for
    // a specific sequenceLength
    float getElementOfPermutation(float index, float sequenceLength, float seed) {
      float oneBasedIndex = index + 1.0; // Alternatively: (mod(index, sequenceLength) + 1.0);
      float fraction = mod(oneBasedIndex * seed, 1.0);
      return ceil(fraction * sequenceLength);
    }

    vec3 convertCellIdToRGB(vec4 id) {
      float golden_ratio = 0.618033988749895;
      float square_root_two = 1.41421;
      float lastEightBits = id.r;
      float significantSegmentIndex = 255.0 * id.g + id.r;

      float colorCount = 17.;
      float colorIndex = getElementOfPermutation(significantSegmentIndex, colorCount, square_root_two);
      float colorValue = 1.0 / colorCount * colorIndex;

      // Old colorValue calculation
      // colorValue = mod(lastEightBits * golden_ratio, 1.0);

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

      vec3 worldCoordUVW = 1.0 / 10.0 * getWorldCoordUVW();

      vec2 worldCoordUV = vec2(worldCoordUVW.x, worldCoordUVW.y);

      float angleCount = 19.;
      float angleSeed = 0.618033988749895;
      float angle = 1.0 / angleCount * getElementOfPermutation(significantSegmentIndex, angleCount, angleSeed);

      // When zooming out, coordinates change faster which make the pattern more turbulent. Dividing by the
      // zoomStep compensates this.
      float stripe_value = mix(
        worldCoordUVW.x / (zoomStep + 1.0),
        worldCoordUVW.y / (zoomStep + 1.0),
        angle
      );
      float aa_stripe_value = aa_step(stripe_value);

      vec4 HSV = vec4(
        colorValue,
        1.0 - aa_stripe_value * segmentationPatternOpacity / 100.0,
        1.0,
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
