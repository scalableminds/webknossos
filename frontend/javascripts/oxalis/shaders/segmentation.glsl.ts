import {
  hsvToRgb,
  jsRgb2hsv,
  getElementOfPermutation,
  jsGetElementOfPermutation,
  aaStep,
  colormapJet,
  jsColormapJet,
} from "oxalis/shaders/utils.glsl";
import type { Vector3, Vector4 } from "oxalis/constants";
import type { ShaderModule } from "./shader_module_system";
import { getRgbaAtIndex } from "./texture_access.glsl";
import { hashCombine } from "./hashing.glsl";
import { attemptMappingLookUp } from "./mappings.glsl";

export const convertCellIdToRGB: ShaderModule = {
  requirements: [
    hsvToRgb,
    getRgbaAtIndex,
    getElementOfPermutation,
    aaStep,
    colormapJet,
    hashCombine,
  ],
  code: `
    highp uint vec4ToUint(vec4 idLow) {
      uint integerValue = (uint(idLow.a) << 24) | (uint(idLow.b) << 16) | (uint(idLow.g) << 8) | uint(idLow.r);
      return integerValue;
    }

    vec4 uintToVec4(uint integerValue) {
      float r = float(integerValue & uint(0xFF));
      float g = float((integerValue >> 8) & uint(0xFF));
      float b = float((integerValue >> 16) & uint(0xFF));
      float a = float((integerValue >> 24) & uint(0xFF));

      vec4 id = vec4(r, g, b, a);
      return id;
    }

    vec3 attemptCustomColorLookUp(uint integerValue, uint seed) {
      highp uint h0 = hashCombine(seed, integerValue);
      // See getDiminishedEntryCapacity() for an explanation about the -1
      h0 = h0 % (COLOR_CUCKOO_ENTRY_CAPACITY - 1u);
      h0 = uint(h0 * COLOR_CUCKOO_ELEMENTS_PER_ENTRY / COLOR_CUCKOO_ELEMENTS_PER_TEXEL);
      highp uint x = h0 % COLOR_CUCKOO_TWIDTH;
      highp uint y = h0 / COLOR_CUCKOO_TWIDTH;

      uvec4 customEntry = texelFetch(custom_color_texture, ivec2(x, y), 0);
      uvec3 customColor = customEntry.gba;

      if (customEntry.r != uint(integerValue)) {
         return vec3(-1);
      }

      return vec3(customColor) / 255.;
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

      uint integerValue = vec4ToUint(idLow);
      vec3 customColor = attemptCustomColorLookUp(integerValue, custom_color_seeds[0]);
      if (customColor.r == -1.) {
        customColor = attemptCustomColorLookUp(integerValue, custom_color_seeds[1]);
      }
      if (customColor.r == -1.) {
        customColor = attemptCustomColorLookUp(integerValue, custom_color_seeds[2]);
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

      float baseVoxelSize = min(min(voxelSizeFactor.x, voxelSizeFactor.y), voxelSizeFactor.z);
      vec3 anisotropyFactorUVW = transDim(voxelSizeFactor) / baseVoxelSize;
      worldCoordUVW.x = worldCoordUVW.x * anisotropyFactorUVW.x;
      worldCoordUVW.y = worldCoordUVW.y * anisotropyFactorUVW.y;

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
// Output is in [0,1] for R, G, B, and A
export const jsConvertCellIdToRGBA = (
  id: number,
  customColors?: Array<Vector3> | null | undefined,
  alpha: number = 1,
): Vector4 => {
  if (id === 0) {
    // Return white
    return [1, 1, 1, 1];
  }

  let rgb;

  if (customColors != null) {
    const last8Bits = id % 2 ** 8;
    rgb = customColors[last8Bits] || [0, 0, 0];
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
    rgb = jsColormapJet(colorValueDecimal);
  }

  return [...rgb, alpha];
};
// Output is in [0,1] for H, S, L, and A
export const jsConvertCellIdToHSLA = (
  id: number,
  customColors?: Array<Vector3> | null | undefined,
  alpha: number = 1,
): Vector4 => {
  const [r, g, b] = jsConvertCellIdToRGBA(id, customColors, alpha);
  const hue = (1 / 360) * jsRgb2hsv([r, g, b])[0];
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

      // Compute the anisotropy of the dataset so that the brush looks the same in
      // each viewport
      float baseVoxelSize = min(min(voxelSizeFactor.x, voxelSizeFactor.y), voxelSizeFactor.z);
      vec3 anisotropyFactorUVW = transDim(voxelSizeFactor) / baseVoxelSize;

      float dist = length((floor(worldCoordUVW.xy) - transDim(flooredMousePos).xy) * anisotropyFactorUVW.xy);

      float radius = ceil(brushSizeInPixel / 2.0);
      if (radius > dist) {
        brushOverlayColor = vec4(vec3(1.0), 0.5);
      }

      return brushOverlayColor;
    }
  `,
};

export const getCrossHairOverlay: ShaderModule = {
  code: `
    vec4 getCrossHairOverlay(vec3 worldCoordUVW) {
      // An active segment position of -1, -1, -1 indicates that the position is not available
      if (activeSegmentPosition == vec3(-1.0)) {
        return vec4(0.0);
      }

      vec3 flooredGlobalPosUVW = transDim(floor(globalPosition));
      vec3 activeSegmentPosUVW = transDim(activeSegmentPosition);

      // Compute the anisotropy of the dataset so that the cross hair looks the same in
      // each viewport
      float baseVoxelSize = min(min(voxelSizeFactor.x, voxelSizeFactor.y), voxelSizeFactor.z);
      vec3 anisotropyFactorUVW = transDim(voxelSizeFactor) / baseVoxelSize;

      // Compute the distance in screen coordinate space to show a zoom-independent cross hair
      vec2 distanceVector = (worldCoordUVW.xy - activeSegmentPosUVW.xy) * anisotropyFactorUVW.xy / zoomValue;

      vec4 crossHairColor = vec4(1.0, 1.0, 1.0, 0.5);
      crossHairColor.a = float(
        // Only show the cross hair in proofreading mode ...
        isProofreading &&
        // ... when no supervoxel is highlighted in 3D viewport (the cross
        // position might not reflect the selected supervoxel which can be confusing).
        !isUnmappedSegmentHighlighted &&
        // ... on the exact w-slice ...
        flooredGlobalPosUVW.z == floor(activeSegmentPosUVW.z) &&
        // ... with this extent ...
        max(abs(distanceVector.x), abs(distanceVector.y)) < 12.0 &&
        // ... with this thickness ...
        (abs(distanceVector.x) < 2.0 || abs(distanceVector.y) < 2.0) &&
        // ... leaving some free space in the middle.
        max(abs(distanceVector.x), abs(distanceVector.y)) > 4.0
      );

      return crossHairColor;
    }
  `,
};

export const getSegmentId: ShaderModule = {
  requirements: [getRgbaAtIndex, convertCellIdToRGB, attemptMappingLookUp],
  code: `

  <% _.each(segmentationLayerNames, function(segmentationName, layerIndex) { %>
    void getSegmentId_<%= segmentationName %>(vec3 worldPositionUVW, out vec4[2] segment_id, out vec4[2] mapped_id) {
      vec3 transformedCoordUVW = transDim((<%= segmentationName %>_transform * vec4(transDim(worldPositionUVW), 1.0)).xyz);
      if (isOutsideOfBoundingBox(transformedCoordUVW)) {
        // Some GPUs don't null-initialize the variables.
        segment_id[0] = vec4(0.);
        segment_id[1] = vec4(0.);
        mapped_id[0] = vec4(0.);
        mapped_id[1] = vec4(0.);
        return;
      }

      segment_id =
        getSegmentIdOrFallback(
          <%= formatNumberAsGLSLFloat(colorLayerNames.length + layerIndex) %>,
          <%= segmentationName %>_data_texture_width,
          <%= formatNumberAsGLSLFloat(textureLayerInfos[segmentationName].packingDegree) %>,
          transformedCoordUVW,
          vec4(0.0, 0.0, 0.0, 0.0),
          !<%= segmentationName %>_has_transform
        );

      // Depending on the packing degree, the returned volume color contains extra values
      // which should be ignored (e.g., when comparing a cell id with the hovered cell
      // passed via uniforms).

      <% if (textureLayerInfos[segmentationName].packingDegree === 4) { %>
        segment_id[1] = vec4(segment_id[1].r, 0.0, 0.0, 0.0);
      <% } else if (textureLayerInfos[segmentationName].packingDegree === 2) { %>
        segment_id[1] = vec4(segment_id[1].r, segment_id[1].g, 0.0, 0.0);
      <% } %>

      mapped_id[0] = 255. * segment_id[0]; // High
      mapped_id[1] = 255. * segment_id[1]; // Low

      uint high_integer = vec4ToUint(mapped_id[0]);
      uint low_integer = vec4ToUint(mapped_id[1]);

      if (shouldApplyMappingOnGPU) {
        ivec2 mapped_entry = is_mapping_64bit
          ? attemptMappingLookUp64(high_integer, low_integer, mapping_seeds[0])
          : attemptMappingLookUp32(low_integer, mapping_seeds[0]);
        if (mapped_entry.r == -1) {
          mapped_entry = is_mapping_64bit
          ? attemptMappingLookUp64(high_integer, low_integer, mapping_seeds[1])
          : attemptMappingLookUp32(low_integer, mapping_seeds[1]);
        }
        if (mapped_entry.r == -1) {
          mapped_entry = is_mapping_64bit
            ? attemptMappingLookUp64(high_integer, low_integer, mapping_seeds[2])
            : attemptMappingLookUp32(low_integer, mapping_seeds[2]);
        }
        if (mapped_entry.r != -1) {
          mapped_id[0] = uintToVec4(uint(mapped_entry[0]));
          mapped_id[1] = uintToVec4(uint(mapped_entry[1]));
        } else if (hideUnmappedIds || mappingIsPartial) {
          // If the mapping is partially known to the front-end (this is the case for HDF5 mappings),
          // we hide unmapped ids. As soon as they are loaded, the segments will appear.
          mapped_id[0] = vec4(0.0);
          mapped_id[1] = vec4(0.0);
        }
      }

      segment_id[0] *= 255.0;
      segment_id[1] *= 255.0;
    }
<% }) %>
  `,
};
