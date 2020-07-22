// @flow
import type { ShaderModule } from "./shader_module_system";
import { binarySearchIndex } from "./mappings.glsl";
import { getRgbaAtIndex } from "./texture_access.glsl";
import { hsvToRgb } from "./utils.glsl";

export const convertCellIdToRGB: ShaderModule = {
  requirements: [hsvToRgb, getRgbaAtIndex],
  code: `

    // https://www.shadertoy.com/view/wtjGzt
    float aastep(float x) {     // --- antialiased step(.5)
        float w = fwidth(x);    // pixel width. NB: x must not be discontinuous or factor discont out
        return smoothstep(.7,-.7,(abs(fract(x-.25)-.5)-.25)/w); // just use (offseted) smooth squares
    }

    float rand(vec2 co){
        return fract(sin(dot(co.xy, vec2(12.9898,78.233))) * 43758.5453);
    }


    vec3 convertCellIdToRGB(vec4 id) {
      float golden_ratio = 0.618033988749895;
      float lastEightBits = id.r;
      float value = mod( lastEightBits * golden_ratio, 1.0);

      <% if (isMappingSupported) { %>
        // If the first element of the mapping colors texture is still the initialized
        // value of -1, no mapping colors have been specified
        bool hasCustomMappingColors = getRgbaAtIndex(
          <%= segmentationName %>_mapping_color_texture,
          <%= mappingColorTextureWidth %>,
          0.0
        ).r != -1.0;
        if (isMappingEnabled && hasCustomMappingColors) {
          value = getRgbaAtIndex(
            <%= segmentationName %>_mapping_color_texture,
            <%= mappingColorTextureWidth %>,
            lastEightBits
          ).r;
        }
      <% } %>

      vec3 worldCoordUVW = 1.0 / 10.0 * getWorldCoordUVW();

      // anti aliasing
      vec2 worldCoordUV = vec2(worldCoordUVW.x, worldCoordUVW.y);
      float dp = length(vec2(abs(dFdx(worldCoordUV.x)), abs(dFdy(worldCoordUV.y))));
      float Frequency = 0.5;
      float edge = dp * Frequency * 2.0;


      float pos = mix(
        worldCoordUVW.x,
        worldCoordUVW.y,
        floor(rand(id.rg) * 10.) / 10.0
        // floor((lastEightBits) / (255. / 10.)) / 10.0
      );


      float stripe_value = aastep(pos);

      vec4 HSV = vec4( value, 0.5 + mod(lastEightBits / 2.0, 1.0), 1.0, 1.0 );
      return mix(hsvToRgb(HSV).xyz, vec3(stripe_value), 0.5);
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
