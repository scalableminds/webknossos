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
    vec4 getRgbaAtIndex(sampler2D dtexture, float textureWidth, float idx) {
      float finalPosX = mod(idx, textureWidth);
      float finalPosY = div(idx, textureWidth);

      return texture2D(
          dtexture,
          vec2(
            (floor(finalPosX) + 0.5) / textureWidth,
            (floor(finalPosY) + 0.5) / textureWidth
          )
        ).rgba;
    }

    uvec4 getUnsignedRgbaAtIndex(highp usampler2D dtexture, float textureWidth, float idx) {
      float finalPosX = mod(idx, textureWidth);
      float finalPosY = div(idx, textureWidth);

      return texelFetch(
        dtexture, ivec2(finalPosX, finalPosY), 0
      ).rgba;
    }
  `,
};
export const getRgbaAtXYIndex: ShaderModule = {
  code: `
    // Define this function for each segmentation and color layer, since iOS cannot handle
    // sampler2D textures[dataTextureCountPerLayer]
    // as a function parameter properly

    <% _.each(layerNamesWithSegmentation, (name) => { %>
      vec4 getRgbaAtXYIndex_<%= name %>(float textureIdx, float x, float y) {
        // Since WebGL 1 doesnt allow dynamic texture indexing, we use an exhaustive if-else-construct
        // here which checks for each case individually. The else-if-branches are constructed via
        // lodash templates.

        <% if (dataTextureCountPerLayer === 1) { %>
            // Don't use if-else when there is only one data texture anyway

            return texelFetch(<%= name + "_textures" %>[0], ivec2(x, y), 0).rgba;
        <% } else { %>
          if (textureIdx == 0.0) {
            return texelFetch(<%= name + "_textures" %>[0], ivec2(x, y), 0).rgba;
          } <% _.range(1, dataTextureCountPerLayer).forEach(textureIndex => { %>
          else if (textureIdx == <%= formatNumberAsGLSLFloat(textureIndex) %>) {
            return texelFetch(<%= name + "_textures" %>[<%= textureIndex %>], ivec2(x, y), 0).rgba;
          }
          <% }) %>
          return vec4(0.5, 0.0, 0.0, 0.0);
        <% } %>
      }
    <% }); %>

    vec4 getRgbaAtXYIndex(float layerIndex, float textureIdx, float x, float y) {
      if (layerIndex == 0.0) {
        return getRgbaAtXYIndex_<%= layerNamesWithSegmentation[0] %>(textureIdx, x, y);
      } <% _.each(layerNamesWithSegmentation.slice(1), (name, index) => { %>
        else if (layerIndex == <%= formatNumberAsGLSLFloat(index + 1) %>) {
          return getRgbaAtXYIndex_<%= name %>(textureIdx, x, y);
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

    // todo: DRY this with hashCombine (currently only due to import problems here).
    highp uint hashCombine2(highp uint state, highp uint value) {
      // The used constants are written in decimal, because
      // the parser tests don't support unsigned int hex notation
      // (yet).
      // See this issue: https://github.com/ShaderFrog/glsl-parser/issues/1
      // 3432918353u == 0xcc9e2d51u
      //  461845907u == 0x1b873593u
      // 3864292196u == 0xe6546b64u

      value *= 3432918353u;
      value = (value << 15u) | (value >> 17u);
      value *= 461845907u;
      state ^= value;
      state = (state << 13u) | (state >> 19u);
      state = (state * 5u) + 3864292196u;
      return state;
    }
    float attemptLookUpLookUp(uint layerIdx, uvec4 bucketAddress, uint seed) {
      highp uint h0 = (
        hashCombine2(
          hashCombine2(
            hashCombine2(
              hashCombine2(
                hashCombine2(seed, bucketAddress.x),
                bucketAddress.y
              ),
              bucketAddress.z
            ),
            layerIdx
          ),
          bucketAddress.a
        )
      ) % LOOKUP_CUCKOO_ENTRY_CAPACITY;
      h0 = uint(h0 * LOOKUP_CUCKOO_ELEMENTS_PER_ENTRY / LOOKUP_CUCKOO_ELEMENTS_PER_TEXEL);
      highp uint x = h0 % LOOKUP_CUCKOO_TWIDTH;
      highp uint y = h0 / LOOKUP_CUCKOO_TWIDTH;

      uvec4 compressedEntry = texelFetch(lookup_texture, ivec2(x, y), 0);

      uint compressedBytes = compressedEntry.a;
      uint foundLayerIdx = compressedBytes >> (32u - 5u);
      uint foundMagIdx = (compressedBytes >> 12u) & (uint(pow(2., 15.)) - 1u);

      if (compressedEntry.xyz != bucketAddress.xyz
        || layerIdx != foundLayerIdx
        || foundMagIdx != bucketAddress.a) {
        return -1.;
      }
      uint address = compressedBytes & (uint(pow(2., 12.)) - 1u);

      return float(address);
    }

    float lookUpBucket(uint layerIndex, uvec4 bucketAddress) {
      float bucketAddressInTexture = attemptLookUpLookUp(layerIndex, bucketAddress, lookup_seed0);
      if (bucketAddressInTexture == -1.) {
        bucketAddressInTexture = attemptLookUpLookUp(layerIndex, bucketAddress, lookup_seed1);
      }
      if (bucketAddressInTexture == -1.) {
        bucketAddressInTexture = attemptLookUpLookUp(layerIndex, bucketAddress, lookup_seed2);
      }
      return bucketAddressInTexture;
    }

    vec4[2] getColorForCoords64(
      highp usampler2D lookUpTexture,
      float layerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 worldPositionUVW
    ) {
      // This method looks up the color data at the given position.
      // The data will be clamped to be non-negative, since negative data
      // is reserved for missing buckets.

      // Will hold [highValue, lowValue];
      vec4 returnValue[2];

      if (worldPositionUVW.x < 0. || worldPositionUVW.y < 0. || worldPositionUVW.z < 0.) {
        // should alpha be -1.0?
        returnValue[1] = vec4(0.0, 0.0, 0.0, 0.0);
        return returnValue;
      }

      uint activeMagIdx = uint(activeMagIndices[int(layerIndex)]);

      float bucketAddress;
      vec3 offsetInBucket;
      float renderedZoomStep;

      for (uint i = 0u; i < 4u; i++) {
        renderedZoomStep = float(activeMagIdx + i);
        vec3 coords = floor(getAbsoluteCoords(worldPositionUVW, layerIndex, renderedZoomStep));
        vec3 absoluteBucketPosition = div(coords, bucketWidth);
        offsetInBucket = mod(coords, bucketWidth);
        bucketAddress = lookUpBucket(
          uint(layerIndex),
          uvec4(uvec3(absoluteBucketPosition), activeMagIdx + i)
        );

        if (bucketAddress != -1.) {
          break;
        }
      }

      if (bucketAddress < 0. ||
          isNan(bucketAddress)) {
        // Not-yet-existing data is encoded with a = -1.0
        // todo: restore gray-when-loading behavior and also
        // ensure that out-of-bbox data is rendered black
        // (formerly encoded as -2 in the look up buffer).
        // returnValue[1] = vec4(0.0, 0.0, 0.0, -1.0);
        returnValue[1] = vec4(0.0, 0.0, 0.0, 0.0);
        return returnValue;
      }

      float zoomStep = activeMagIndices[int(layerIndex)];
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
        vec3 coords = floor(getAbsoluteCoords(worldPositionUVW, layerIndex, zoomStep));
        offsetInBucket = mod(coords, bucketWidth);
        vec3 worldBucketPosition = div(coords, bucketWidth);

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

      // The lower 32-bit of the value.
      vec4 bucketColor = getRgbaAtXYIndex(
        layerIndex,
        textureIndex,
        x,
        y
      );

      if (packingDegree == 0.5) {
        vec4 bucketColorHigh = getRgbaAtXYIndex(
          layerIndex,
          textureIndex,
          // x + 1.0 will never exceed the texture width because
          // - the texture width is even
          // - and x is guaranteed to be even, too (due dividing by
          //   packingDegree=0.5)
          x + 1.0,
          // Since x + 1.0 won't "overflow", y doesn't need to be
          // adapted, either.
          y
        );

        returnValue[0] =  bucketColorHigh;
        returnValue[1] = bucketColor;
        return returnValue;
      }

      if (packingDegree == 1.0) {
        returnValue[1] = max(bucketColor, 0.0);
        return returnValue;
      }

      float rgbaIndex = linearizeVec3ToIndexWithMod(offsetInBucket, bucketWidth, packingDegree);

      if (packingDegree == 2.0) {
        // It's essentially irrelevant what we return as the 3rd and 4th value here as we only have 2 byte of information.
        // The caller needs to unpack this vec4 according to the packingDegree, see getSegmentationId for an example.
        // The same goes for the following code where the packingDegree is 4 and we only have 1 byte of information.
        if (rgbaIndex == 0.0) {
          returnValue[1] = vec4(
            max(bucketColor.r, 0.0),
            max(bucketColor.g, 0.0),
            max(bucketColor.r, 0.0),
            max(bucketColor.g, 0.0)
          );
          return returnValue;
        } else if (rgbaIndex == 1.0) {
          returnValue[1] = vec4(
            max(bucketColor.b, 0.0),
            max(bucketColor.a, 0.0),
            max(bucketColor.b, 0.0),
            max(bucketColor.a, 0.0)
          );
          return returnValue;
        }
      }

      // The following code deals with packingDegree == 4.0
      if (rgbaIndex == 0.0) {
        returnValue[1] = vec4(max(bucketColor.r, 0.0));
        return returnValue;
      } else if (rgbaIndex == 1.0) {
        returnValue[1] = vec4(max(bucketColor.g, 0.0));
        return returnValue;
      } else if (rgbaIndex == 2.0) {
        returnValue[1] = vec4(max(bucketColor.b, 0.0));
        return returnValue;
      } else if (rgbaIndex == 3.0) {
        returnValue[1] = vec4(max(bucketColor.a, 0.0));
        return returnValue;
      }

      returnValue[1] = vec4(0.0);
      return returnValue;
    }

    vec4 getColorForCoords(
      highp usampler2D lookUpTexture,
      float layerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 worldPositionUVW
    ) {
      // The potential overhead of delegating to the 64-bit variant (instead of using a specialized
      // 32-bit variant) was measured by rendering 600 times consecutively (without throttling).
      // No clear negative impact could be measured which is why this delegation should be ok.
      vec4[2] retVal = getColorForCoords64(lookUpTexture, layerIndex, d_texture_width, packingDegree, worldPositionUVW);
      return retVal[1];
    }
  `,
};
