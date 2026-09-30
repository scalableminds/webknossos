import { MAX_ZOOM_STEP_DIFF } from "viewer/model/bucket_data_handling/loading_strategy_logic";
import { getAbsoluteCoords, getMagnificationFactors } from "viewer/shaders/coords.glsl";
import { hashCombine } from "./hashing.glsl";
import type { ShaderModule } from "./shader_module_system";
import { transDim } from "./utils.glsl";

const linearizeVec3ToIndex: ShaderModule = {
  requirements: [],
  code: `
    // E.g., the vector [9, 5, 2] will be linearized to the scalar index 900 + 50 + 2, when base == 10
    float linearizeVec3ToIndex(vec3 position, float base) {
      return position.z * base * base + position.y * base + position.x;
    }

    float linearizeVec3ToIndex(vec3 position, vec3 base) {
      return position.z * base.x * base.y + position.y * base.x + position.x;
    }
`,
};
const linearizeVec3ToIndexWithMod: ShaderModule = {
  requirements: [],
  code: `
    // Same as linearizeVec3ToIndex. However, a mod parameter m can be passed when the final index
    // is going to be modded, anyway. This circumvents floating overflows by modding the intermediary results.
    float linearizeVec3ToIndexWithMod(vec3 position, float base, float m) {
      return mod(mod(position.z * base * base, m) + mod(position.y * base, m) + position.x, m);
    }
`,
};

const getRgbaAtXYIndex: ShaderModule = {
  code: `
    // Every layer -- color or segmentation -- reads from one of 5 shared,
    // dtype-keyed sampler2DArray pools (see layerPoolId/ColorLayerPool in
    // main_data_shaders.glsl.ts / data_rendering_logic.ts) via a single,
    // layer-count-independent dispatch -- no per-layer function/uniform
    // needed, since a texture array's slice index is a dynamic texture
    // coordinate, not a compile-time sampler-array index (which is what
    // used to require one generated function per layer here).
    vec4 getRgbaAtXYIndex(float localLayerIndex, float textureIdx, float x, float y) {
      uint idx = uint(localLayerIndex);
      uint poolId = layerPoolId[idx];
      float dtypeNormalizer = layerDtypeNormalizer[idx];
      ivec3 coord = ivec3(int(x), int(y), int(textureIdx));
      if (poolId == 0u) {
        // F32 pool: native float values, no rescaling.
        return texelFetch(pool_f32_textures, coord, 0);
      } else if (poolId == 2u) {
        // S8 pool: hardware SNORM-decoded to [-1, 1] already.
        return dtypeNormalizer * texelFetch(pool_s8_textures, coord, 0);
      } else if (poolId == 3u) {
        // U16 pool: integer sampler, raw component values (no normalizer).
        uvec4 val = texelFetch(pool_u16_textures, coord, 0);
        return vec4(val.x, 0., val.y, 0.);
      } else if (poolId == 4u) {
        // S16 pool: integer sampler, raw component values (no normalizer).
        ivec4 val = texelFetch(pool_s16_textures, coord, 0);
        return vec4(val.x, 0., val.y, 0.);
      }
      // U8 pool: hardware UNORM-decoded to [0, 1] already.
      return dtypeNormalizer * texelFetch(pool_u8_textures, coord, 0);
    }
  `,
};
export const getColorForCoords: ShaderModule = {
  requirements: [
    linearizeVec3ToIndex,
    linearizeVec3ToIndexWithMod,
    getRgbaAtXYIndex,
    getAbsoluteCoords,
    getMagnificationFactors,
    hashCombine,
    transDim,
  ],
  code: `
    float NOT_YET_COMMITTED_VALUE = pow(2., 21.) - 1.;

    float attemptLookUpLookUp(uint globalLayerIndex, uvec4 bucketAddress, uint seed) {
      <% if (!isFragment) { %>
        outputSeed[globalLayerIndex] = seed;
      <% } %>


      highp uint h0 = hashCombine(seed, bucketAddress.x);
      h0 = hashCombine(h0, bucketAddress.y);
      h0 = hashCombine(h0, bucketAddress.z);
      h0 = hashCombine(h0, bucketAddress.a);
      h0 = hashCombine(h0, globalLayerIndex);
      h0 = h0 % LOOKUP_CUCKOO_ENTRY_CAPACITY;
      h0 = uint(h0 * LOOKUP_CUCKOO_ELEMENTS_PER_ENTRY / LOOKUP_CUCKOO_ELEMENTS_PER_TEXEL);

      highp uint x = h0 % LOOKUP_CUCKOO_TWIDTH;
      highp uint y = h0 / LOOKUP_CUCKOO_TWIDTH;

      uvec4 compressedEntry = texelFetch(lookup_texture, ivec2(x, y), 0);

      uint compressedBytes = compressedEntry.a;
      uint foundMagIdx = compressedBytes >> (32u - 5u);
      uint foundLayerIndex = (compressedBytes >> 21u) & (uint(pow(2., 6.)) - 1u);

      if (compressedEntry.xyz != bucketAddress.xyz
        || globalLayerIndex != foundLayerIndex
        || foundMagIdx != bucketAddress.a) {
        <% if (!isFragment) { %>
          outputAddress[globalLayerIndex] = -1.;
        <% } %>
        return -1.;
      }
      uint address = compressedBytes & (uint(pow(2., 21.)) - 1u);

      <% if (!isFragment) { %>
        outputAddress[globalLayerIndex] = float(address);
      <% } %>

      return float(address);
    }

    float lookUpBucket(uint globalLayerIndex, uvec4 bucketAddress, bool supportsPrecomputedBucketAddress) {
      // The fragment shader can read the entry that was
      // calculated by the vertex shader. However, this won't always
      // be precise because the triangles of the plane won't necessarily
      // align with the bucket borders.
      <% if (isFragment) { %>
        if (supportsPrecomputedBucketAddress) {
          return outputAddress[globalLayerIndex];
        }
      <% } %>


      float bucketAddressInTexture = attemptLookUpLookUp(globalLayerIndex, bucketAddress, lookup_seeds[0]);
      if (bucketAddressInTexture == -1.) {
        bucketAddressInTexture = attemptLookUpLookUp(globalLayerIndex, bucketAddress, lookup_seeds[1]);
      }
      if (bucketAddressInTexture == -1.) {
        bucketAddressInTexture = attemptLookUpLookUp(globalLayerIndex, bucketAddress, lookup_seeds[2]);
      }
      return bucketAddressInTexture;
    }

    vec4[2] getColorForCoords64(
      float localLayerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 worldPositionUVW,
      bool supportsPrecomputedBucketAddress
    ) {
      // This method looks up the color data at the given position.
      // The data will be clamped to be non-negative, since negative data
      // is reserved for missing buckets.

      // Will hold [highValue, lowValue];
      vec4 returnValue[2];
      returnValue[0] = vec4(0.0);
      returnValue[1] = vec4(0.0);

      if (worldPositionUVW.x < 0. || worldPositionUVW.y < 0. || worldPositionUVW.z < 0.) {
        // Negative coordinates would likely produce incorrect bucket look ups due to casting
        // (the keys are stored as uint). Render black.
        returnValue[1] = vec4(0.0, 0.0, 0.0, 0.0);
        return returnValue;
      }

      uint globalLayerIndex = availableLayerIndexToGlobalLayerIndex[uint(localLayerIndex)];
      uint activeMagIdx = uint(activeMagIndices[int(globalLayerIndex)]);

      float bucketAddress;
      vec3 offsetInBucket;
      uint renderedMagIdx = activeMagIdx;

      // outputMagIdx/outputSeed/outputAddress only have entries for layers
      // below VERTEX_ALIGNMENT_LAYER_CAP (see its declaration and the
      // vertex shader's bucket-alignment loop) -- layers beyond that always
      // take the full per-fragment lookup path below, just like transformed
      // layers already do. For layers within the cap, also don't use the
      // precomputed bucket address when being at the border of buckets, to
      // avoid rare rendering artifacts.
      bool beSafe = globalLayerIndex >= VERTEX_ALIGNMENT_LAYER_CAP || useBucketBorderVertexOptimization < 0.5;
      if (!beSafe) {
        renderedMagIdx = outputMagIdx[globalLayerIndex];
        vec3 coords = floor(getAbsoluteCoords(worldPositionUVW, renderedMagIdx, globalLayerIndex));
        vec3 absoluteBucketPosition = div(coords, bucketWidth);
        offsetInBucket = mod(coords, bucketWidth);
        vec3 offsetInBucketUVW = transDim(offsetInBucket);
        if (offsetInBucketUVW.x < 0.01 || offsetInBucketUVW.y < 0.01
            || offsetInBucketUVW.x >= 31. || offsetInBucketUVW.y >= 31.
            || isnan(offsetInBucketUVW.x) || isnan(offsetInBucketUVW.y)
            || isnan(offsetInBucketUVW.z)
          ) {
          beSafe = true;
        }
      }


      if (beSafe || !supportsPrecomputedBucketAddress) {
        for (uint i = 0u; i <= ${MAX_ZOOM_STEP_DIFF}u; i++) {
          renderedMagIdx = activeMagIdx + i;
          vec3 coords = floor(getAbsoluteCoords(worldPositionUVW, renderedMagIdx, globalLayerIndex));
          vec3 absoluteBucketPosition = div(coords, bucketWidth);
          offsetInBucket = mod(coords, bucketWidth);
          bucketAddress = lookUpBucket(
            globalLayerIndex,
            uvec4(uvec3(absoluteBucketPosition), renderedMagIdx),
            (supportsPrecomputedBucketAddress && !beSafe)
          );

          if (bucketAddress != -1. && bucketAddress != NOT_YET_COMMITTED_VALUE) {
            break;
          }
        }
      } else {
        // Use mag that was precomputed in vertex shader. Also,
        // lookUpBucket() will use the precomputed address.
        renderedMagIdx = outputMagIdx[globalLayerIndex];
        vec3 coords = floor(getAbsoluteCoords(worldPositionUVW, renderedMagIdx, globalLayerIndex));
        vec3 absoluteBucketPosition = div(coords, bucketWidth);
        offsetInBucket = mod(coords, bucketWidth);
        bucketAddress = lookUpBucket(
          globalLayerIndex,
          uvec4(uvec3(absoluteBucketPosition), renderedMagIdx),
          supportsPrecomputedBucketAddress
        );
      }


      if (bucketAddress == NOT_YET_COMMITTED_VALUE) {
        // No bucket was found that was already committed.
        // Not-yet-existing data is encoded with a = -1.0
        // and will be rendered gray.
        returnValue[1] = vec4(0.0, 0.0, 0.0, -1.0);
        return returnValue;
      }

      if (bucketAddress < 0. || isnan(bucketAddress)) {
        // The requested data could not be found in the look up
        // table. Render black.
        returnValue[1] = vec4(0.0, 0.0, 0.0, 0.0);
        return returnValue;
      }

      if (renderedMagIdx != activeMagIdx) {
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
         * with the magnification factor. A typical magnification factor is 2.
         */

        vec3 magnificationFactors = getMagnificationFactors(renderedMagIdx, activeMagIdx, globalLayerIndex);
        vec3 coords = floor(getAbsoluteCoords(worldPositionUVW, activeMagIdx, globalLayerIndex));
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
        localLayerIndex,
        textureIndex,
        x,
        y
      );

      if (packingDegree == 0.5) {
        vec4 bucketColorHigh = getRgbaAtXYIndex(
          localLayerIndex,
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
        // Negative values in the alpha channel would result in this
        // value being interpreted as missing. Therefore, we are clamping
        // the alpha value.
        returnValue[1] = vec4(bucketColor.xyz, max(bucketColor.a, 0.0));
        return returnValue;
      }

      float rgbaIndex = linearizeVec3ToIndexWithMod(offsetInBucket, bucketWidth, packingDegree);

      if (packingDegree == 2.0) {
        // It's essentially irrelevant what we return as the 3rd and 4th value here as we only have 2 byte of information.
        // The caller needs to unpack this vec4 according to the packingDegree, see getSegmentId for an example.
        // The same goes for the following code where the packingDegree is 4 and we only have 1 byte of information.
        if (rgbaIndex == 0.0) {
          returnValue[1] = vec4(
            bucketColor.r,
            bucketColor.g,
            bucketColor.r,
            1.0
          );
          return returnValue;
        } else if (rgbaIndex == 1.0) {
          returnValue[1] = vec4(
            bucketColor.b,
            bucketColor.a,
            bucketColor.b,
            1.0
          );
          return returnValue;
        }
      }

      // The following code deals with packingDegree == 4.0
      if (rgbaIndex == 0.0) {
        returnValue[1] = vec4(vec3(bucketColor.r), 1.0);
        return returnValue;
      } else if (rgbaIndex == 1.0) {
        returnValue[1] = vec4(vec3(bucketColor.g), 1.0);
        return returnValue;
      } else if (rgbaIndex == 2.0) {
        returnValue[1] = vec4(vec3(bucketColor.b), 1.0);
        return returnValue;
      } else if (rgbaIndex == 3.0) {
        returnValue[1] = vec4(vec3(bucketColor.a), 1.0);
        return returnValue;
      }

      returnValue[1] = vec4(0.0);
      return returnValue;
    }

    vec4 getColorForCoords(
      float localLayerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 worldPositionUVW,
      bool supportsPrecomputedBucketAddress
    ) {
      // The potential overhead of delegating to the 64-bit variant (instead of using a specialized
      // 32-bit variant) was measured by rendering 600 times consecutively (without throttling).
      // No clear negative impact could be measured which is why this delegation should be ok.
      vec4[2] retVal = getColorForCoords64(localLayerIndex, d_texture_width, packingDegree, worldPositionUVW, supportsPrecomputedBucketAddress);
      return retVal[1];
    }
  `,
};
