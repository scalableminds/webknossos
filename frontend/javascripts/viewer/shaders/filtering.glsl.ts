import type { ShaderModule } from "./shader_module_system";
import { getColorForCoords } from "./texture_access.glsl";
export const getBilinearColorFor: ShaderModule = {
  requirements: [getColorForCoords],
  code: `

    vec4 getBilinearColorFor(
      float layerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 coordsUVW
    ) {
      coordsUVW = coordsUVW + vec3(-0.5, -0.5, 0.0);
      vec2 bifilteringParams = (coordsUVW - floor(coordsUVW)).xy;
      coordsUVW = floor(coordsUVW);
      bool supportsPrecomputedBucketAddress = false;

      // On most systems unrolling this loop will lead to much slower shader compilation and
      // possibly WebGL crashes, because some compilers cannot optimize it as well then.
      // However, on windows machines the loop often leads to compilation crashes and
      // the unrolled version can be optimized much better.
      vec4 samples[4];

      <% if (isWindows) { %>
       samples[0] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW, supportsPrecomputedBucketAddress);
       samples[1] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 0, 0), supportsPrecomputedBucketAddress);
       samples[2] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(0, 1, 0), supportsPrecomputedBucketAddress);
       samples[3] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 1, 0), supportsPrecomputedBucketAddress);
      <% } else { %>
        int idx = 0;
        for (int y = 0; y <= 1; y++) {
            for (int x = 0; x <= 1; x++) {
                vec3 offset = vec3(x, y, 0);
                samples[idx] = getColorForCoords(
                    layerIndex, d_texture_width, packingDegree,
                    coordsUVW + offset,
                    supportsPrecomputedBucketAddress
                );
                idx++;
            }
        }
      <% } %>

      if (samples[0].a < 0.0 || samples[1].a < 0.0 || samples[2].a < 0.0 || samples[3].a < 0.0) {
        // We need to check all four colors for a negative parts, because there will be black
        // lines at the borders otherwise (black gets mixed with data)
        return vec4(0.0, 0.0, 0.0, -1.0);
      }

      vec4 ab = mix(samples[0], samples[1], bifilteringParams.x);
      vec4 cd = mix(samples[2], samples[3], bifilteringParams.x);

      return mix(ab, cd, bifilteringParams.y);
    }
  `,
};
export const getTrilinearColorFor: ShaderModule = {
  requirements: [getColorForCoords],
  code: `
    vec4 getTrilinearColorFor(
      float layerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 coordsUVW
    ) {
      coordsUVW = coordsUVW + vec3(-0.5, -0.5, 0.0);
      vec3 bifilteringParams = (coordsUVW - floor(coordsUVW)).xyz;
      coordsUVW = floor(coordsUVW);
      bool supportsPrecomputedBucketAddress = false;

      // On most systems unrolling this loop will lead to much slower shader compilation and
      // possibly WebGL crashes, because some compilers cannot optimize it as well then.
      // However, on windows machines the loop often leads to compilation crashes and
      // the unrolled version can be optimized much better.
      vec4 samples[8];

      <% if (isWindows) { %>
        samples[0] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW, supportsPrecomputedBucketAddress);
        samples[1] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 0, 0), supportsPrecomputedBucketAddress);
        samples[2] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(0, 1, 0), supportsPrecomputedBucketAddress);
        samples[3] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 1, 0), supportsPrecomputedBucketAddress);
        samples[4] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(0, 0, 1), supportsPrecomputedBucketAddress);
        samples[5] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 0, 1), supportsPrecomputedBucketAddress);
        samples[6] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(0, 1, 1), supportsPrecomputedBucketAddress);
        samples[7] = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 1, 1), supportsPrecomputedBucketAddress);
      <% } else { %>
        int idx = 0;
        for (int z = 0; z <= 1; z++) {
            for (int y = 0; y <= 1; y++) {
                for (int x = 0; x <= 1; x++) {
                    vec3 offset = vec3(x, y, z);
                    samples[idx] = getColorForCoords(
                        layerIndex, d_texture_width, packingDegree,
                        coordsUVW + offset,
                        supportsPrecomputedBucketAddress
                    );
                    idx++;
                }
            }
        }
      <% } %>

      if (samples[0].a < 0.0 || samples[1].a < 0.0 || samples[2].a < 0.0 || samples[3].a < 0.0 ||
        samples[4].a < 0.0 || samples[5].a < 0.0 || samples[6].a < 0.0 || samples[7].a < 0.0) {
        // We need to check all eight colors for a negative parts, because there will be black
        // lines at the borders otherwise (black gets mixed with data)
        return vec4(0.0, 0.0, 0.0, -1.0);
      }

      vec4 ab = mix(samples[0], samples[1], bifilteringParams.x);
      vec4 cd = mix(samples[2], samples[3], bifilteringParams.x);
      vec4 abcd = mix(ab, cd, bifilteringParams.y);

      vec4 ab2 = mix(samples[4], samples[5], bifilteringParams.x);
      vec4 cd2 = mix(samples[6], samples[7], bifilteringParams.x);

      vec4 abcd2 = mix(ab2, cd2, bifilteringParams.y);

      return mix(abcd, abcd2, bifilteringParams.z);
    }
  `,
};
const getMaybeFilteredColor: ShaderModule = {
  requirements: [getColorForCoords, getBilinearColorFor, getTrilinearColorFor],
  code: `
    vec4 getMaybeFilteredColor(
      float layerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 worldPositionUVW,
      bool supportsPrecomputedBucketAddress
    ) {
      vec4 color;
      <% if (useInterpolation) { %>
        <% if (isOrthogonal) { %>
          if(isFlycamRotated){
            color = getTrilinearColorFor(layerIndex, d_texture_width, packingDegree, worldPositionUVW);
          } else {
            color = getBilinearColorFor(layerIndex, d_texture_width, packingDegree, worldPositionUVW);
          }
        <% } else { %>
          color = getTrilinearColorFor(layerIndex, d_texture_width, packingDegree, worldPositionUVW);
        <% } %>
      <% } else { %>
        color = getColorForCoords(layerIndex, d_texture_width, packingDegree, worldPositionUVW, supportsPrecomputedBucketAddress);
      <% } %>
      return color;
    }
  `,
};
export const getMaybeFilteredColorOrFallback: ShaderModule = {
  requirements: [getMaybeFilteredColor],
  code: `
    struct MaybeFilteredColor {
      vec4 color;
      bool used_fallback_color;
    };

    MaybeFilteredColor getMaybeFilteredColorOrFallback(
      float layerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 worldPositionUVW,
      vec4 fallbackColor,
      bool supportsPrecomputedBucketAddress
    ) {
      MaybeFilteredColor maybe_filtered_color;
      maybe_filtered_color.used_fallback_color = false;
      maybe_filtered_color.color = getMaybeFilteredColor(layerIndex, d_texture_width, packingDegree, worldPositionUVW, supportsPrecomputedBucketAddress);

      if (maybe_filtered_color.color.a < 0.0) {
        // Render gray for not-yet-existing data
        maybe_filtered_color.color = fallbackColor;
        maybe_filtered_color.used_fallback_color = true;
      }
      return maybe_filtered_color;
    }

    vec4[2] getSegmentIdOrFallback(
      float layerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 worldPositionUVW,
      vec4 fallbackColor,
      bool supportsPrecomputedBucketAddress
    ) {
      vec4[2] color = getColorForCoords64(layerIndex, d_texture_width, packingDegree, worldPositionUVW, supportsPrecomputedBucketAddress);

      // Segment ids are always handled as two vec4s (8 byte). On some hardware, floating point
      // accuracies can lead to bytes that are stored incorrectly (e.g., as 0.99999 instead of 1).
      // As a workaround, we round here. A proper (future) fix would probably be to not use floats
      // when accessing textures in the first place.
      color[0] = round(color[0]);
      color[1] = round(color[1]);

      if (color[1].a < 0.0) {
        // Render gray for not-yet-existing data
        color[1] = fallbackColor;
      }

      return color;
    }
  `,
};
