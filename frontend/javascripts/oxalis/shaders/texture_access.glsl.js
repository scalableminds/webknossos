// @flow

import { getResolutionFactors, getRelativeCoords } from "oxalis/shaders/coords.glsl";

import type { ShaderModule } from "./shader_module_system";

export const linearizeVec3ToIndex: ShaderModule = {
  requirements: [],
  code: `
    // E.g., the vector [9, 5, 2]  will be linearized to the scalar index 900 + 50 + 2, when base == 10
    float linearizeVec3ToIndex(vec3 position, float base) {
      return position.z * base * base + position.y * base + position.x;
    }

    float linearizeVec3ToIndex(vec3 position, vec3 base) {
      return position.z * base.x * base.y + position.y * base.x + position.x;
    }
`,
};

export const linearizeVec3ToIndexWithMod: ShaderModule = {
  requirements: [],
  code: `
    // Same as linearizeVec3ToIndex. However, a mod parameter m can be passed when the final index
    // is going to be modded, anyway. This circumvents floating overflows by modding the intermediary results.
    float linearizeVec3ToIndexWithMod(vec3 position, float base, float m) {
      return mod(mod(position.z * base * base, m) + mod(position.y * base, m) + position.x, m);
    }
`,
};

export const getRgbaAtIndex: ShaderModule = {
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

export const getRgbaAtXYIndex: ShaderModule = {
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

export const getColorForCoords: ShaderModule = {
  requirements: [
    linearizeVec3ToIndex,
    linearizeVec3ToIndexWithMod,
    getRgbaAtIndex,
    getRgbaAtXYIndex,
    getRelativeCoords,
    getResolutionFactors,
  ],
  code: `
    vec4 getColorForCoords(
      sampler2D lookUpTexture,
      float layerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 worldPositionUVW
    ) {
      vec3 coords = floor(getRelativeCoords(worldPositionUVW, zoomStep));
      vec3 relativeBucketPosition = div(coords, bucketWidth);
      vec3 offsetInBucket = mod(coords, bucketWidth);

      if (relativeBucketPosition.x > addressSpaceDimensions.x ||
          relativeBucketPosition.y > addressSpaceDimensions.y ||
          relativeBucketPosition.z > addressSpaceDimensions.z ||
          relativeBucketPosition.x < 0.0 ||
          relativeBucketPosition.y < 0.0 ||
          relativeBucketPosition.z < 0.0) {
        // In theory, the current magnification should always be selected
        // so that we won't have to address data outside of the addresSpaceDimensions.
        // Nevertheless, we explicitly guard against this situation here to avoid
        // rendering wrong data.
        return vec4(1.0, 1.0, 0.0, 1.0);
      }

      float bucketIdx = linearizeVec3ToIndex(relativeBucketPosition, addressSpaceDimensions);

      vec2 bucketAddressWithZoomStep = getRgbaAtIndex(
        lookUpTexture,
        l_texture_width,
        bucketIdx
      ).ra;

      float bucketAddress = bucketAddressWithZoomStep.x;
      float renderedZoomStep = bucketAddressWithZoomStep.y;

      if (bucketAddress == -2.0) {
        // The bucket is out of bounds. Render black
        // In flight mode, it can happen that buckets were not passed to the GPU
        // since the approximate implementation of the bucket picker missed the bucket.
        // We simply handle this case as if the bucket was not yet loaded which means
        // that fallback data is loaded.
        // The downside is that data which does not exist, will be rendered gray instead of black.
        // Issue to track progress: #3446
        float alpha = isFlightMode() ? -1.0 : 0.0;
        return vec4(0.0, 0.0, 0.0, alpha);
      }

      if (bucketAddress < 0. ||
          isNan(bucketAddress)) {
        // Not-yet-existing data is encoded with a = -1.0
        return vec4(0.0, 0.0, 0.0, -1.0);
      }

      if (renderedZoomStep != zoomStep) {
        /* We already know which fallback bucket we have to look into. However,
         * for 8 mag-1 buckets, there is usually one fallback bucket in mag-2.
         * Therefore, depending on the actual mag-1 bucket, we have to look into
         * different sub-volumes of the one fallback bucket. This is calculated as
         * the subVolumeIndex.
         * Then, we adapt the look up position *within* the bucket.
         *
         * Example Scenario (let's consider only the x axis):
         * If we are in the [4, _, _, 0]-bucket, we have to look into the **first** half
         * of the [2, _, _, 1]-bucket.
         * If we are in the [5, _, _, 0]-bucket, we have to look into the **second** half
         * of the [2, _, _, 1]-bucket.
         * We can determine which "half" (subVolumeIndex) is relevant by doing a modulo operation
         * with the resolution factor. A typical resolution factor is 2.
         */

        vec3 magnificationFactors = getResolutionFactors(renderedZoomStep, zoomStep);
        vec3 worldBucketPosition = relativeBucketPosition + anchorPoint;
        vec3 subVolumeIndex = mod(worldBucketPosition, magnificationFactors);
        offsetInBucket = floor(
          (offsetInBucket + vec3(bucketWidth) * subVolumeIndex)
          / magnificationFactors
        );
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

      if (packingDegree == 2.0) {
        // It's essentially irrelevant what we return as the 3rd and 4th value here as we only have 2 byte of information.
        // The caller needs to unpack this vec4 according to the packingDegree, see getSegmentationId for an example.
        // The same goes for the following code where the packingDegree is 4 and we only have 1 byte of information.
        if (rgbaIndex == 0.0) {
          return vec4(bucketColor.r, bucketColor.g, bucketColor.r, bucketColor.g);
        } else if (rgbaIndex == 1.0) {
          return vec4(bucketColor.b, bucketColor.a, bucketColor.b, bucketColor.a);
        }
      }

      // The following code deals with packingDegree == 4.0
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
