// @flow
import type { ShaderModuleType } from "./shader_module_system";
import { hsvToRgb } from "./utils.glsl";
import { binarySearchIndex } from "./mappings.glsl";
import { getRgbaAtIndex } from "./texture_access.glsl";

export const convertCellIdToRGB: ShaderModuleType = {
  requirements: [hsvToRgb, getRgbaAtIndex],
  code: `
    vec4 convertCellIdToRGB(vec4 id) {
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

      vec4 HSV = vec4( value, 1.0, 1.0, 1.0 );
      // If the value was not specified, although custom colors are present, the segment should be transparent
      return vec4(hsvToRgb(HSV), value == -1.0 ? 0.0 : 1.0);
    }
  `,
};

export const getBrushOverlay: ShaderModuleType = {
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

      float radius = round(brushSizeInPixel * pixelToVoxelFactor / 2.0);
      if (radius > dist) {
        brushOverlayColor = vec4(vec3(1.0), 0.5);
      }

      return brushOverlayColor;
    }
  `,
};

export const getSegmentationId: ShaderModuleType = {
  requirements: [binarySearchIndex, getRgbaAtIndex],
  code: `
    vec4 getSegmentationId(vec3 coords, vec3 fallbackCoords, bool hasFallback) {
      vec4 volume_color =
        getMaybeFilteredColorOrFallback(
          <%= segmentationName %>_lookup_texture,
          <%= formatNumberAsGLSLFloat(segmentationLayerIndex) %>,
          <%= segmentationName %>_data_texture_width,
          <%= segmentationPackingDegree %>,
          coords,
          fallbackCoords,
          hasFallback,
          true, // Don't use bilinear filtering for volume data
          vec4(0.0, 0.0, 0.0, 0.0)
        );


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
