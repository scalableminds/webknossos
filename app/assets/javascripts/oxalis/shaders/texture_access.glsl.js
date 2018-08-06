// @flow

import type { ShaderModuleType } from "./shader_module_system";

export const linearizeVec3ToIndex: ShaderModuleType = {
  requirements: [],
  code: `
    // E.g., the vector [9, 5, 2]  will be linearized to the scalar index 900 + 50 + 2, when base == 10
    float linearizeVec3ToIndex(vec3 position, float base) {
      return position.z * base * base + position.y * base + position.x;
    }
`,
};

export const linearizeVec3ToIndexWithMod: ShaderModuleType = {
  requirements: [],
  code: `
    // Same as linearizeVec3ToIndex. However, a mod parameter m can be passed when the final index
    // is going to be modded, anyway. This circumvents floating overflows by modding the intermediary results.
    float linearizeVec3ToIndexWithMod(vec3 position, float base, float m) {
      return mod(mod(position.z * base * base, m) + mod(position.y * base, m) + position.x, m);
    }
`,
};

export const getRgbaAtIndex: ShaderModuleType = {
  code: `
    vec4 getRgbaAtIndex(sampler2D texture, float textureWidth, float idx) {
      float finalPosX = mod(idx, textureWidth);
      float finalPosY = div(idx, textureWidth);

      return texture2D(
          texture,
          vec2(
            (floor(finalPosX) + 0.5) / textureWidth,
            (floor(finalPosY) + 0.5) / textureWidth
          )
        ).rgba;
    }
  `,
};

export const getRgbaAtXYIndex: ShaderModuleType = {
  code: `
    vec4 getRgbaAtXYIndex(sampler2D texture, float textureWidth, float x, float y) {
      return texture2D(
          texture,
          vec2(
            (floor(x) + 0.5) / textureWidth,
            (floor(y) + 0.5) / textureWidth
          )
        ).rgba;
    }

    // Define this function for each segmentation and color layer, since iOS cannot handle
    // sampler2D textures[dataTextureCountPerLayer]
    // as a function parameter properly

    <% _.each(layerNamesWithSegmentation, (name) => { %>
      vec4 getRgbaAtXYIndex_<%= name %>(float textureIdx, float textureWidth, float x, float y) {
        vec2 accessPoint = (floor(vec2(x, y)) + 0.5) / textureWidth;

        // Since WebGL 1 doesnt allow dynamic texture indexing, we use an exhaustive if-else-construct
        // here which checks for each case individually. The else-if-branches are constructed via
        // lodash templates.

        <% if (dataTextureCountPerLayer === 1) { %>
            // Don't use if-else when there is only one data texture anyway
            return texture2D(<%= name + "_textures" %>[0], accessPoint).rgba;
        <% } else { %>
          if (textureIdx == 0.0) {
            return texture2D(<%= name + "_textures" %>[0], accessPoint).rgba;
          } <% _.range(1, dataTextureCountPerLayer).forEach(textureIndex => { %>
          else if (textureIdx == <%= formatNumberAsGLSLFloat(textureIndex) %>) {
            return texture2D(<%= name + "_textures" %>[<%= textureIndex %>], accessPoint).rgba;
          }
          <% }) %>
          return vec4(0.5, 0.0, 0.0, 0.0);
        <% } %>
      }
    <% }); %>

    vec4 getRgbaAtXYIndex(float layerIndex, float textureIdx, float textureWidth, float x, float y) {
      if (layerIndex == 0.0) {
        return getRgbaAtXYIndex_<%= layerNamesWithSegmentation[0] %>(textureIdx, textureWidth, x, y);
      } <% _.each(layerNamesWithSegmentation.slice(1), (name, index) => { %>
        else if (layerIndex == <%= formatNumberAsGLSLFloat(index + 1) %>) {
          return getRgbaAtXYIndex_<%= name %>(textureIdx, textureWidth, x, y);
        }
      <% }); %>
      return vec4(0.0);
    }
  `,
};

const getColorFor: ShaderModuleType = {
  requirements: [
    linearizeVec3ToIndex,
    linearizeVec3ToIndexWithMod,
    getRgbaAtIndex,
    getRgbaAtXYIndex,
  ],
  code: `
    vec4 getColorFor(
      sampler2D lookUpTexture,
      float layerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 bucketPosition,
      vec3 offsetInBucket,
      float isFallback
    ) {
      float bucketIdx = linearizeVec3ToIndex(bucketPosition, bucketsPerDim);

      // If we are making a fallback lookup, the lookup area we are interested in starts at
      // bucketsPerDim**3. if isFallback is true, we use that offset. Otherwise, the offset is 0.
      float fallbackOffset = isFallback * bucketsPerDim * bucketsPerDim * bucketsPerDim;
      float bucketIdxInTexture =
        bucketIdx * floatsPerLookUpEntry
        + fallbackOffset;

      float bucketAddress = getRgbaAtIndex(
        lookUpTexture,
        l_texture_width,
        bucketIdxInTexture
      ).x;

      if (bucketAddress == -2.0) {
        // The bucket is out of bounds. Render black
        return vec4(0.0, 0.0, 0.0, 0.0);
      }

      if (bucketAddress < 0. || isNan(bucketAddress)) {
        // Not-yet-existing data is encoded with a = -1.0
        return vec4(0.0, 0.0, 0.0, -1.0);
      }

      // bucketAddress can span multiple data textures. If the address is higher
      // than the capacity of one texture, we mod the value and use the div (floored division) as the
      // texture index
      float packedBucketSize = bucketSize / packingDegree;
      float bucketCapacityPerTexture = d_texture_width * d_texture_width / packedBucketSize;
      float textureIndex = floor(bucketAddress / bucketCapacityPerTexture);
      bucketAddress = mod(bucketAddress, bucketCapacityPerTexture);

      float x =
        // Mod while linearizing to avoid imprecisions for large numbers
        linearizeVec3ToIndexWithMod(offsetInBucket / packingDegree, bucketWidth, d_texture_width);

      float pixelIdxInBucket =
        // Don't mod since we have to calculate pixelIdxInBucket / d_texture_width
        linearizeVec3ToIndex(offsetInBucket / packingDegree, bucketWidth);
      float y =
        div(pixelIdxInBucket, d_texture_width) +
        div(packedBucketSize * bucketAddress, d_texture_width);

      vec4 bucketColor = getRgbaAtXYIndex(
        layerIndex,
        textureIndex,
        d_texture_width,
        x,
        y
      );

      if (packingDegree == 1.0) {
        return bucketColor;
      }

      float rgbaIndex = linearizeVec3ToIndexWithMod(offsetInBucket, bucketWidth, packingDegree);

      if (rgbaIndex == 0.0) {
        return vec4(bucketColor.r);
      } else if (rgbaIndex == 1.0) {
        return vec4(bucketColor.g);
      } else if (rgbaIndex == 2.0) {
        return vec4(bucketColor.b);
      } else if (rgbaIndex == 3.0) {
        return vec4(bucketColor.a);
      }

      return vec4(0.0);
    }
  `,
};

export const getColorForCoords: ShaderModuleType = {
  requirements: [getColorFor],
  code: `
    vec4 getColorForCoords(
      sampler2D lookUpTexture,
      float layerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 coords,
      float isFallback
    ) {
      coords = floor(coords);
      vec3 bucketPosition = div(coords, bucketWidth);
      vec3 offsetInBucket = mod(coords, bucketWidth);

      return getColorFor(
        lookUpTexture,
        layerIndex,
        d_texture_width,
        packingDegree,
        bucketPosition,
        offsetInBucket,
        isFallback
      );
    }
  `,
};
