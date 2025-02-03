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
      vec4 a = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW, supportsPrecomputedBucketAddress);
      vec4 b = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 0, 0), supportsPrecomputedBucketAddress);
      vec4 c = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(0, 1, 0), supportsPrecomputedBucketAddress);
      vec4 d = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 1, 0), supportsPrecomputedBucketAddress);
      if (a.a < 0.0 || b.a < 0.0 || c.a < 0.0 || d.a < 0.0) {
        // We need to check all four colors for a negative parts, because there will be black
        // lines at the borders otherwise (black gets mixed with data)
        return vec4(0.0, 0.0, 0.0, -1.0);
      }

      vec4 ab = mix(a, b, bifilteringParams.x);
      vec4 cd = mix(c, d, bifilteringParams.x);

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

      vec4 a = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW, supportsPrecomputedBucketAddress);
      vec4 b = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 0, 0), supportsPrecomputedBucketAddress);
      vec4 c = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(0, 1, 0), supportsPrecomputedBucketAddress);
      vec4 d = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 1, 0), supportsPrecomputedBucketAddress);

      vec4 a2 = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(0, 0, 1), supportsPrecomputedBucketAddress);
      vec4 b2 = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 0, 1), supportsPrecomputedBucketAddress);
      vec4 c2 = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(0, 1, 1), supportsPrecomputedBucketAddress);
      vec4 d2 = getColorForCoords(layerIndex, d_texture_width, packingDegree, coordsUVW + vec3(1, 1, 1), supportsPrecomputedBucketAddress);

      if (a.a < 0.0 || b.a < 0.0 || c.a < 0.0 || d.a < 0.0 ||
        a2.a < 0.0 || b2.a < 0.0 || c2.a < 0.0 || d2.a < 0.0) {
        // We need to check all four colors for a negative parts, because there will be black
        // lines at the borders otherwise (black gets mixed with data)
        return vec4(0.0, 0.0, 0.0, -1.0);
      }

      vec4 ab = mix(a, b, bifilteringParams.x);
      vec4 cd = mix(c, d, bifilteringParams.x);
      vec4 abcd = mix(ab, cd, bifilteringParams.y);

      vec4 ab2 = mix(a2, b2, bifilteringParams.x);
      vec4 cd2 = mix(c2, d2, bifilteringParams.x);

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
      bool suppressBilinearFiltering,
      bool supportsPrecomputedBucketAddress
    ) {
      vec4 color;
      if (!suppressBilinearFiltering && useBilinearFiltering) {
        <% if (isOrthogonal) { %>
          color = getBilinearColorFor(layerIndex, d_texture_width, packingDegree, worldPositionUVW);
        <% } else { %>
          color = getTrilinearColorFor(layerIndex, d_texture_width, packingDegree, worldPositionUVW);
        <% } %>
      } else {
        color = getColorForCoords(layerIndex, d_texture_width, packingDegree, worldPositionUVW, supportsPrecomputedBucketAddress);
      }
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
      bool suppressBilinearFiltering,
      vec4 fallbackColor,
      bool supportsPrecomputedBucketAddress
    ) {
      MaybeFilteredColor maybe_filtered_color;
      maybe_filtered_color.used_fallback_color = false;
      maybe_filtered_color.color = getMaybeFilteredColor(layerIndex, d_texture_width, packingDegree, worldPositionUVW, suppressBilinearFiltering, supportsPrecomputedBucketAddress);

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

      if (color[1].a < 0.0) {
        // Render gray for not-yet-existing data
        color[1] = fallbackColor;
      }

      // if (color[1].x * 256. > 55126.) {
      //   // debug
      //   color[1] = vec4(1.);
      // } else {
      //     color[1] = vec4(0.);
      // }

      return color;
    }
  `,
};
