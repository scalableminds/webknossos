
precision highp float;


uniform vec2 viewportExtent;

uniform float activeMagIndices[5];
uniform uint availableLayerIndexToGlobalLayerIndex[5];
uniform vec3 allMagnifications[5];
uniform uint magnificationCountCumSum[5];
uniform bool isFlycamRotated;
uniform bool doAllLayersHaveTransforms;
uniform mat4 inverseFlycamRotationMatrix;

uniform highp usampler2D lookup_texture;
uniform highp uint lookup_seeds[3];
uniform highp uint LOOKUP_CUCKOO_ENTRY_CAPACITY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_ENTRY;
uniform highp uint LOOKUP_CUCKOO_ELEMENTS_PER_TEXEL;
uniform highp uint LOOKUP_CUCKOO_TWIDTH;


  uniform highp sampler2D layer_Y29sb3JfZmxvYXQ_textures[1];
  uniform float layer_Y29sb3JfZmxvYXQ_data_texture_width;
  uniform float layer_Y29sb3JfZmxvYXQ_alpha;
  uniform float layer_Y29sb3JfZmxvYXQ_gammaCorrectionValue;
  uniform float layer_Y29sb3JfZmxvYXQ_unrenderable;
  uniform mat4 layer_Y29sb3JfZmxvYXQ_transform;
  uniform bool layer_Y29sb3JfZmxvYXQ_has_transform;
  uniform vec3 layer_Y29sb3JfZmxvYXQ_bboxMin;
  uniform vec3 layer_Y29sb3JfZmxvYXQ_bboxMax;

  uniform highp sampler2D layer_Y29sb3JfZmxvYXRfc21hbGw_textures[1];
  uniform float layer_Y29sb3JfZmxvYXRfc21hbGw_data_texture_width;
  uniform float layer_Y29sb3JfZmxvYXRfc21hbGw_alpha;
  uniform float layer_Y29sb3JfZmxvYXRfc21hbGw_gammaCorrectionValue;
  uniform float layer_Y29sb3JfZmxvYXRfc21hbGw_unrenderable;
  uniform mat4 layer_Y29sb3JfZmxvYXRfc21hbGw_transform;
  uniform bool layer_Y29sb3JfZmxvYXRfc21hbGw_has_transform;
  uniform vec3 layer_Y29sb3JfZmxvYXRfc21hbGw_bboxMin;
  uniform vec3 layer_Y29sb3JfZmxvYXRfc21hbGw_bboxMax;

  uniform highp usampler2D layer_Y29sb3JfdWludDE2_textures[1];
  uniform float layer_Y29sb3JfdWludDE2_data_texture_width;
  uniform float layer_Y29sb3JfdWludDE2_alpha;
  uniform float layer_Y29sb3JfdWludDE2_gammaCorrectionValue;
  uniform float layer_Y29sb3JfdWludDE2_unrenderable;
  uniform mat4 layer_Y29sb3JfdWludDE2_transform;
  uniform bool layer_Y29sb3JfdWludDE2_has_transform;
  uniform vec3 layer_Y29sb3JfdWludDE2_bboxMin;
  uniform vec3 layer_Y29sb3JfdWludDE2_bboxMax;

  uniform highp sampler2D layer_Y29sb3JfdWludDI0_textures[1];
  uniform float layer_Y29sb3JfdWludDI0_data_texture_width;
  uniform float layer_Y29sb3JfdWludDI0_alpha;
  uniform float layer_Y29sb3JfdWludDI0_gammaCorrectionValue;
  uniform float layer_Y29sb3JfdWludDI0_unrenderable;
  uniform mat4 layer_Y29sb3JfdWludDI0_transform;
  uniform bool layer_Y29sb3JfdWludDI0_has_transform;
  uniform vec3 layer_Y29sb3JfdWludDI0_bboxMin;
  uniform vec3 layer_Y29sb3JfdWludDI0_bboxMax;

  uniform highp sampler2D layer_Y29sb3JfdWludDg_textures[1];
  uniform float layer_Y29sb3JfdWludDg_data_texture_width;
  uniform float layer_Y29sb3JfdWludDg_alpha;
  uniform float layer_Y29sb3JfdWludDg_gammaCorrectionValue;
  uniform float layer_Y29sb3JfdWludDg_unrenderable;
  uniform mat4 layer_Y29sb3JfdWludDg_transform;
  uniform bool layer_Y29sb3JfdWludDg_has_transform;
  uniform vec3 layer_Y29sb3JfdWludDg_bboxMin;
  uniform vec3 layer_Y29sb3JfdWludDg_bboxMax;



  uniform vec3 layer_Y29sb3JfZmxvYXQ_color;
  uniform float layer_Y29sb3JfZmxvYXQ_min;
  uniform float layer_Y29sb3JfZmxvYXQ_max;
  uniform float layer_Y29sb3JfZmxvYXQ_is_inverted;

  uniform vec3 layer_Y29sb3JfZmxvYXRfc21hbGw_color;
  uniform float layer_Y29sb3JfZmxvYXRfc21hbGw_min;
  uniform float layer_Y29sb3JfZmxvYXRfc21hbGw_max;
  uniform float layer_Y29sb3JfZmxvYXRfc21hbGw_is_inverted;

  uniform vec3 layer_Y29sb3JfdWludDE2_color;
  uniform float layer_Y29sb3JfdWludDE2_min;
  uniform float layer_Y29sb3JfdWludDE2_max;
  uniform float layer_Y29sb3JfdWludDE2_is_inverted;

  uniform vec3 layer_Y29sb3JfdWludDI0_color;
  uniform float layer_Y29sb3JfdWludDI0_min;
  uniform float layer_Y29sb3JfdWludDI0_max;
  uniform float layer_Y29sb3JfdWludDI0_is_inverted;

  uniform vec3 layer_Y29sb3JfdWludDg_color;
  uniform float layer_Y29sb3JfdWludDg_min;
  uniform float layer_Y29sb3JfdWludDg_max;
  uniform float layer_Y29sb3JfdWludDg_is_inverted;




uniform float sphericalCapRadius;
uniform bool selectiveVisibilityInProofreading;
uniform float viewMode;
uniform float alpha;
uniform bool renderBucketIndices;
uniform vec3 globalPosition;
uniform vec3 positionOffset;
uniform vec3 proofreadingMarkerPosition;
uniform float zoomValue;
uniform float blendMode;
uniform vec3 globalMousePosition;
uniform bool isMouseInCanvas;
uniform float brushSizeInPixel;
uniform float planeID;
uniform vec3 addressSpaceDimensions;
uniform uint hoveredSegmentIdLow;
uniform uint hoveredSegmentIdHigh;
uniform uint hoveredUnmappedSegmentIdLow;
uniform uint hoveredUnmappedSegmentIdHigh;

// For some reason, taking the dataset scale from the uniform results in imprecise
// rendering of the brush circle (and issues in flight mode). That's why it
// is directly inserted into the source via templating.
const vec3 voxelSizeFactor = vec3(1.0, 1.0, 100.0);
const vec3 voxelSizeFactorInverted = vec3(1.0, 1.0, 0.01);

const vec4 fallbackGray = vec4(0.5, 0.5, 0.5, 1.0);
const float bucketWidth = 32.0;
const float bucketSize = 32768.0;


flat in vec2 index;
flat in uint outputMagIdx[5];
flat in uint outputSeed[5];
flat in float outputAddress[5];
flat in float useBucketBorderVertexOptimization;
in vec4 worldCoord;
in vec4 modelCoord;
in mat4 savedModelMatrix;


    in vec3 tpsOffsetXYZ_layer_Y29sb3JfZmxvYXQ;



    // https://github.com/glslify/glsl-inverse/blob/master/index.glsl
    mat4 inverseMatrix(mat4 m) {
      float
        a00 = m[0][0], a01 = m[0][1], a02 = m[0][2], a03 = m[0][3],
        a10 = m[1][0], a11 = m[1][1], a12 = m[1][2], a13 = m[1][3],
        a20 = m[2][0], a21 = m[2][1], a22 = m[2][2], a23 = m[2][3],
        a30 = m[3][0], a31 = m[3][1], a32 = m[3][2], a33 = m[3][3],

        b00 = a00 * a11 - a01 * a10,
        b01 = a00 * a12 - a02 * a10,
        b02 = a00 * a13 - a03 * a10,
        b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11,
        b05 = a02 * a13 - a03 * a12,
        b06 = a20 * a31 - a21 * a30,
        b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30,
        b09 = a21 * a32 - a22 * a31,
        b10 = a21 * a33 - a23 * a31,
        b11 = a22 * a33 - a23 * a32,

        det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

      return mat4(
        a11 * b11 - a12 * b10 + a13 * b09,
        a02 * b10 - a01 * b11 - a03 * b09,
        a31 * b05 - a32 * b04 + a33 * b03,
        a22 * b04 - a21 * b05 - a23 * b03,
        a12 * b08 - a10 * b11 - a13 * b07,
        a00 * b11 - a02 * b08 + a03 * b07,
        a32 * b02 - a30 * b05 - a33 * b01,
        a20 * b05 - a22 * b02 + a23 * b01,
        a10 * b10 - a11 * b08 + a13 * b06,
        a01 * b08 - a00 * b10 - a03 * b06,
        a30 * b04 - a31 * b02 + a33 * b00,
        a21 * b02 - a20 * b04 - a23 * b00,
        a11 * b07 - a10 * b09 - a12 * b06,
        a00 * b09 - a01 * b07 + a02 * b06,
        a31 * b01 - a30 * b03 - a32 * b00,
        a20 * b03 - a21 * b01 + a22 * b00) / det;
    }



    float div(float a, float b) {
      return floor(a / b);
    }

    vec3 div(vec3 a, float b) {
      return floor(a / b);
    }



    bool isFlightMode() {
      return viewMode == 1.0;
    }



    // Similar to the transDim function in dimensions.js, this function transposes dimensions for the current plane.
    vec3 transDim(vec3 array) {
      if (planeID == 0.0) {
        return array;
      } else if (planeID == 1.0) {
        return vec3(array.z, array.y, array.x); // [2, 1, 0]
      } else if (planeID == 2.0) {
        return vec3(array.x, array.z, array.y); // [0, 2, 1]
      } else {
        return vec3(0.0, 0.0, 0.0);
      }
    }



    vec3 getMagnification(uint zoomStep, uint globalLayerIndex) {
      return allMagnifications[zoomStep + magnificationCountCumSum[globalLayerIndex]];
    }



    vec3 getAbsoluteCoords(vec3 worldCoordUVW, uint usedZoomStep, uint globalLayerIndex) {
      vec3 magnification = getMagnification(usedZoomStep, globalLayerIndex);
      vec3 coords = transDim(worldCoordUVW) / magnification;
      return coords;
    }



    float getW(vec3 vector) {
      if (planeID == 0.0) {
        return vector[2];
      } else if (planeID == 1.0) {
        return vector[0];
      } else if (planeID == 2.0) {
        return vector[1];
      }
      return 0.0;
    }



    vec3 worldCoordToUVW(vec4 worldCoord) {
      vec3 worldCoordUVW = transDim(worldCoord.xyz);
      vec3 positionOffsetUVW = transDim(positionOffset);

      bool isInFlightMode = isFlightMode();

      if (isInFlightMode) {
        vec4 modelCoords = inverseMatrix(savedModelMatrix) * worldCoord;
        float sphericalRadius = sphericalCapRadius;

        vec4 centerVertex = vec4(0.0, 0.0, -sphericalRadius, 0.0);
        modelCoords.z = 0.0;
        modelCoords += centerVertex;
        modelCoords.xyz = modelCoords.xyz * (sphericalRadius / length(modelCoords.xyz));
        modelCoords -= centerVertex;

        worldCoordUVW = (savedModelMatrix * modelCoords).xyz;
      }

      vec3 voxelSizeFactorInvertedUVW = transDim(voxelSizeFactorInverted);

      // We subtract the potential offset of the plane and then
      // need to multiply by voxelSizeFactorInvertedUVW because the threejs scene is scaled.
      worldCoordUVW = (worldCoordUVW - positionOffsetUVW) * voxelSizeFactorInvertedUVW;

      // Numerical imprecision in floating point calculation might cause the w component to be off by one.
      // E.g. if the w component is an integer w = 1.0 in voxel space, the floating point operation via * voxelSizeFactorInvertedUVW
      // which transforms the global coordinates back to voxel space, might end up with w=0.9999, which is wrong.
      // But we know that for unrotated none flight mode planes this is constant.
      // Thus, in this case we can copy over the matching coordinate from the globalPosition uniform to obtain a correct w component.
      if(!isInFlightMode && !isFlycamRotated){
        worldCoordUVW.z = transDim(globalPosition).z;
      }


      return worldCoordUVW;
    }



    vec3 getWorldCoordUVW() {
      return worldCoordToUVW(worldCoord);
    }



    bool isOutsideOfBoundingBox(vec3 worldCoordUVW, vec3 bboxMin, vec3 bboxMax) {
      vec3 worldCoord = transDim(worldCoordUVW);
      return (
        worldCoord.x < bboxMin.x || worldCoord.y < bboxMin.y || worldCoord.z < bboxMin.z ||
        worldCoord.x >= bboxMax.x || worldCoord.y >= bboxMax.y || worldCoord.z >= bboxMax.z
      );
    }



    // E.g., the vector [9, 5, 2] will be linearized to the scalar index 900 + 50 + 2, when base == 10
    float linearizeVec3ToIndex(vec3 position, float base) {
      return position.z * base * base + position.y * base + position.x;
    }

    float linearizeVec3ToIndex(vec3 position, vec3 base) {
      return position.z * base.x * base.y + position.y * base.x + position.x;
    }



    // Same as linearizeVec3ToIndex. However, a mod parameter m can be passed when the final index
    // is going to be modded, anyway. This circumvents floating overflows by modding the intermediary results.
    float linearizeVec3ToIndexWithMod(vec3 position, float base, float m) {
      return mod(mod(position.z * base * base, m) + mod(position.y * base, m) + position.x, m);
    }



    // Define this function for each segmentation and color layer, since iOS cannot handle
    // sampler2D textures[dataTextureCountPerLayer]
    // as a function parameter properly


      vec4 getRgbaAtXYIndex_layer_Y29sb3JfZmxvYXQ(float textureIdx, float x, float y) {
        // Since WebGL 1 doesn't allow dynamic texture indexing, we use an exhaustive if-else-construct
        // here which checks for each case individually. The else-if-branches are constructed via
        // lodash templates.



        vec4 val;
        float dtype_normalizer = 1.0;


            // Don't use if-else when there is only one data texture anyway
            val = texelFetch(layer_Y29sb3JfZmxvYXQ_textures[0], ivec2(x, y), 0);


              return dtype_normalizer * vec4(val);


      }

      vec4 getRgbaAtXYIndex_layer_Y29sb3JfZmxvYXRfc21hbGw(float textureIdx, float x, float y) {
        // Since WebGL 1 doesn't allow dynamic texture indexing, we use an exhaustive if-else-construct
        // here which checks for each case individually. The else-if-branches are constructed via
        // lodash templates.



        vec4 val;
        float dtype_normalizer = 1.0;


            // Don't use if-else when there is only one data texture anyway
            val = texelFetch(layer_Y29sb3JfZmxvYXRfc21hbGw_textures[0], ivec2(x, y), 0);


              return dtype_normalizer * vec4(val);


      }

      vec4 getRgbaAtXYIndex_layer_Y29sb3JfdWludDE2(float textureIdx, float x, float y) {
        // Since WebGL 1 doesn't allow dynamic texture indexing, we use an exhaustive if-else-construct
        // here which checks for each case individually. The else-if-branches are constructed via
        // lodash templates.



        uvec4 val;
        float dtype_normalizer = 1.0;


            // Don't use if-else when there is only one data texture anyway
            val = texelFetch(layer_Y29sb3JfdWludDE2_textures[0], ivec2(x, y), 0);


              return vec4(val.x, 0., val.y, 0.);


      }

      vec4 getRgbaAtXYIndex_layer_Y29sb3JfdWludDI0(float textureIdx, float x, float y) {
        // Since WebGL 1 doesn't allow dynamic texture indexing, we use an exhaustive if-else-construct
        // here which checks for each case individually. The else-if-branches are constructed via
        // lodash templates.



        vec4 val;
        float dtype_normalizer = 1.0;


            // Don't use if-else when there is only one data texture anyway
            val = texelFetch(layer_Y29sb3JfdWludDI0_textures[0], ivec2(x, y), 0);


              return dtype_normalizer * vec4(val);


      }

      vec4 getRgbaAtXYIndex_layer_Y29sb3JfdWludDg(float textureIdx, float x, float y) {
        // Since WebGL 1 doesn't allow dynamic texture indexing, we use an exhaustive if-else-construct
        // here which checks for each case individually. The else-if-branches are constructed via
        // lodash templates.



        vec4 val;
        float dtype_normalizer = 255.0;


            // Don't use if-else when there is only one data texture anyway
            val = texelFetch(layer_Y29sb3JfdWludDg_textures[0], ivec2(x, y), 0);


              return dtype_normalizer * vec4(val);


      }


    vec4 getRgbaAtXYIndex(float localLayerIndex, float textureIdx, float x, float y) {
      if (localLayerIndex == 0.0) {
        return getRgbaAtXYIndex_layer_Y29sb3JfZmxvYXQ(textureIdx, x, y);
      }
        else if (localLayerIndex == 1.0) {
          return getRgbaAtXYIndex_layer_Y29sb3JfZmxvYXRfc21hbGw(textureIdx, x, y);
        }

        else if (localLayerIndex == 2.0) {
          return getRgbaAtXYIndex_layer_Y29sb3JfdWludDE2(textureIdx, x, y);
        }

        else if (localLayerIndex == 3.0) {
          return getRgbaAtXYIndex_layer_Y29sb3JfdWludDI0(textureIdx, x, y);
        }

        else if (localLayerIndex == 4.0) {
          return getRgbaAtXYIndex_layer_Y29sb3JfdWludDg(textureIdx, x, y);
        }

      return vec4(0.0);
    }



    vec3 getMagnificationFactors(uint zoomStepA, uint zoomStepB, uint globalLayerIndex) {
      return getMagnification(zoomStepA, globalLayerIndex) / getMagnification(zoomStepB, globalLayerIndex);
    }



    highp uint hashCombine(highp uint state, highp uint value) {
      value *= 0xcc9e2d51u;
      value = (value << 15u) | (value >> 17u);
      value *= 0x1b873593u;
      state ^= value;
      state = (state << 13u) | (state >> 19u);
      state = (state * 5u) + 0xe6546b64u;
      return state;
    }



    float NOT_YET_COMMITTED_VALUE = pow(2., 21.) - 1.;

    float attemptLookUpLookUp(uint globalLayerIndex, uvec4 bucketAddress, uint seed) {



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

        return -1.;
      }
      uint address = compressedBytes & (uint(pow(2., 21.)) - 1u);



      return float(address);
    }

    float lookUpBucket(uint globalLayerIndex, uvec4 bucketAddress, bool supportsPrecomputedBucketAddress) {
      // The fragment shader can read the entry that was
      // calculated by the vertex shader. However, this won't always
      // be precise because the triangles of the plane won't necessarily
      // align with the bucket borders.

        if (supportsPrecomputedBucketAddress) {
          return outputAddress[globalLayerIndex];
        }



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
      uint renderedMagIdx;

      // To avoid rare rendering artifacts, don't use the precomputed
      // bucket address when being at the border of buckets.
      bool beSafe = useBucketBorderVertexOptimization < 0.5;
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


      if (beSafe || !supportsPrecomputedBucketAddress) {
        for (uint i = 0u; i <= 3u; i++) {
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


      if (samples[0].a < 0.0 || samples[1].a < 0.0 || samples[2].a < 0.0 || samples[3].a < 0.0) {
        // We need to check all four colors for a negative parts, because there will be black
        // lines at the borders otherwise (black gets mixed with data)
        return vec4(0.0, 0.0, 0.0, -1.0);
      }

      vec4 ab = mix(samples[0], samples[1], bifilteringParams.x);
      vec4 cd = mix(samples[2], samples[3], bifilteringParams.x);

      return mix(ab, cd, bifilteringParams.y);
    }



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



    vec4 getMaybeFilteredColor(
      float layerIndex,
      float d_texture_width,
      float packingDegree,
      vec3 worldPositionUVW,
      bool supportsPrecomputedBucketAddress
    ) {
      vec4 color;

        color = getColorForCoords(layerIndex, d_texture_width, packingDegree, worldPositionUVW, supportsPrecomputedBucketAddress);

      return color;
    }



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




    vec4 blendLayersAdditive(
      vec4 current_color,
      vec4 color_to_add
    ) {
      return current_color + color_to_add;
    }



    // Applying alpha blending to merge the layers where the top most layer has priority.
    // See https://en.wikipedia.org/wiki/Alpha_compositing#Alpha_blending for details.
    vec4 blendLayersCover(
      vec4 current_color,
      vec4 layer_color,
      bool used_fallback_color
    ) {
      float mixed_alpha_factor = (1.0 - current_color.a) * layer_color.a;
      float mixed_alpha = mixed_alpha_factor + current_color.a;
      vec3 cover_color_rgb = current_color.a * current_color.rgb + mixed_alpha_factor * layer_color.rgb;
      // Catching edge case where mixed_alpha is 0.0 and therefore the cover_color would have nan values.
      float is_mixed_alpha_zero = float(mixed_alpha == 0.0);
      vec4 cover_color = vec4(cover_color_rgb / (mixed_alpha + is_mixed_alpha_zero), mixed_alpha);
      cover_color = mix(cover_color, vec4(0.0), is_mixed_alpha_zero);
      // Do not overwrite current_color if the fallback color has been used.
      float is_current_color_valid = float(!used_fallback_color);
      cover_color = mix(current_color, cover_color, is_current_color_valid);
      return cover_color;
    }



    // Like blendLayersCover, but treats black voxels (RGB = 0) as transparent.
    vec4 blendLayersCoverBlackAsTransparent(
      vec4 current_color,
      vec4 layer_color,
      bool used_fallback_color
    ) {
      // If all RGB channels are zero, the voxel is black and should be treated as transparent.
      float is_black = float(layer_color.r == 0.0 && layer_color.g == 0.0 && layer_color.b == 0.0);
      layer_color.a = layer_color.a * (1.0 - is_black);
      return blendLayersCover(current_color, layer_color, used_fallback_color);
    }



    // These functions are useful for debugging.
    bool almostEq(vec3 x, vec3 y, float thresh) {
      vec3 diff = abs(x - y);
      return diff.x <= thresh && diff.y <= thresh && diff.z <= thresh;
    }

    bool almostEq(vec3 x, vec3 y, vec3 thresh) {
      vec3 diff = abs(x - y);
      return diff.x <= thresh.x && diff.y <= thresh.y && diff.z <= thresh.z;
    }

    bool almostEq(float x, float y, float thresh) {
      float diff = abs(x - y);
      return diff <= thresh;
    }



    float scaleIntToFloat(int x, int a, int b) {
      // Convert to uint for safer calculations
      uint ux = uint(x);
      uint ua = uint(a);
      uint ub = uint(b);

      // Calculate the range and offset
      uint range = ub - ua;
      uint offset = ux - ua;

      if (range == 0u) {
        return 0.0;
      }

      // Normalize to [0, 1] as a float
      return float(offset) / float(range);
    }

    vec3 scaleFloatToFloat(vec3 x, float a, float b) {
      if (a == b) {
        return vec3(0.0);
      }

      if (b - a < pow(2., 126.)) {
        // "Small" intervals can be used for scaling without
        // any special care.
        return (x - a) / (b - a);
      } else {
        // For large intervals, floating point precision can collapse
        // to 0. Therefore, we make all values a bit smaller before
        // doing further arithmetic.
        float mul = 0.25;
        vec3 nom = mul * x - mul * a;
        float denom = mul * b - mul * a;
        return nom / denom;
      }
    }


void main() {
  vec3 worldCoordUVW = getWorldCoordUVW();

  if (renderBucketIndices) {
    // Only used for debugging purposes. Will render bucket positions for the
    // first renderable layer.
    uint globalLayerIndex = availableLayerIndexToGlobalLayerIndex[0u];
    uint activeMagIdx = uint(activeMagIndices[int(globalLayerIndex)]);
    vec3 absoluteCoords = getAbsoluteCoords(worldCoordUVW, activeMagIdx, globalLayerIndex);
    vec3 bucketPosition = div(floor(absoluteCoords), bucketWidth);
    gl_FragColor = vec4(bucketPosition, activeMagIdx) / 255.;
    return;
  }
  vec4 data_color = vec4(0.0);



  // Get Color Value(s)
  vec3 color_value  = vec3(0.0);


    float layer_Y29sb3JfZmxvYXQ_effective_alpha = layer_Y29sb3JfZmxvYXQ_alpha * (1. - layer_Y29sb3JfZmxvYXQ_unrenderable);
    if (layer_Y29sb3JfZmxvYXQ_effective_alpha > 0.) {
      // Get grayscale value for color_float


        vec3 layerCoordUVW = worldCoordUVW + transDim(tpsOffsetXYZ_layer_Y29sb3JfZmxvYXQ);


      if (!isOutsideOfBoundingBox(layerCoordUVW, layer_Y29sb3JfZmxvYXQ_bboxMin, layer_Y29sb3JfZmxvYXQ_bboxMax)) {
        MaybeFilteredColor maybe_filtered_color =
          getMaybeFilteredColorOrFallback(
            0.0,
            layer_Y29sb3JfZmxvYXQ_data_texture_width,
            4.0,
            layerCoordUVW,
            fallbackGray,
            !layer_Y29sb3JfZmxvYXQ_has_transform
          );
        bool used_fallback = maybe_filtered_color.used_fallback_color;
        float is_max_and_min_equal = float(layer_Y29sb3JfZmxvYXQ_max == layer_Y29sb3JfZmxvYXQ_min);

        // color_value is usually between 0 and 1.
        color_value = maybe_filtered_color.color.rgb;




            color_value = vec3(color_value.x);


          // Keep the color in bounds of min and max
          color_value = clamp(color_value, layer_Y29sb3JfZmxvYXQ_min, layer_Y29sb3JfZmxvYXQ_max);
          // Scale the color value according to the histogram settings.
          color_value = vec3(
            scaleFloatToFloat(color_value, layer_Y29sb3JfZmxvYXQ_min, layer_Y29sb3JfZmxvYXQ_max)
          );


        color_value = pow(color_value, 1. / vec3(layer_Y29sb3JfZmxvYXQ_gammaCorrectionValue));

        // Maybe invert the color using the inverting_factor
        color_value = abs(color_value - layer_Y29sb3JfZmxvYXQ_is_inverted);
        // Catch the case where max == min would causes a NaN value and use black as a fallback color.
        color_value = mix(color_value, vec3(0.0), is_max_and_min_equal);
        color_value = color_value * layer_Y29sb3JfZmxvYXQ_alpha * layer_Y29sb3JfZmxvYXQ_color;
        // Marking the color as invalid by setting alpha to 0.0 if the fallback color has been used
        // so the fallback color does not cover other colors.
        vec4 layer_color = vec4(color_value, used_fallback ? 0.0 : maybe_filtered_color.color.a * layer_Y29sb3JfZmxvYXQ_alpha);
        // Calculating the color for the current layer depending on blendMode.
        // blendMode == 1.0: Additive, blendMode == 0.0: Cover, blendMode == 2.0: CoverWithBlackAsTransparent
        vec4 additive_color = blendLayersAdditive(data_color, layer_color);
        vec4 cover_color = blendLayersCover(data_color, layer_color, used_fallback);
        vec4 cover_black_transparent_color = blendLayersCoverBlackAsTransparent(data_color, layer_color, used_fallback);
        data_color = mix(cover_color, additive_color, float(blendMode == 1.0));
        data_color = mix(data_color, cover_black_transparent_color, float(blendMode == 2.0));
      }
    }


    float layer_Y29sb3JfZmxvYXRfc21hbGw_effective_alpha = layer_Y29sb3JfZmxvYXRfc21hbGw_alpha * (1. - layer_Y29sb3JfZmxvYXRfc21hbGw_unrenderable);
    if (layer_Y29sb3JfZmxvYXRfc21hbGw_effective_alpha > 0.) {
      // Get grayscale value for color_float_small


        vec3 layerCoordUVW = transDim((layer_Y29sb3JfZmxvYXRfc21hbGw_transform * vec4(transDim(worldCoordUVW), 1.0)).xyz);


      if (!isOutsideOfBoundingBox(layerCoordUVW, layer_Y29sb3JfZmxvYXRfc21hbGw_bboxMin, layer_Y29sb3JfZmxvYXRfc21hbGw_bboxMax)) {
        MaybeFilteredColor maybe_filtered_color =
          getMaybeFilteredColorOrFallback(
            1.0,
            layer_Y29sb3JfZmxvYXRfc21hbGw_data_texture_width,
            4.0,
            layerCoordUVW,
            fallbackGray,
            !layer_Y29sb3JfZmxvYXRfc21hbGw_has_transform
          );
        bool used_fallback = maybe_filtered_color.used_fallback_color;
        float is_max_and_min_equal = float(layer_Y29sb3JfZmxvYXRfc21hbGw_max == layer_Y29sb3JfZmxvYXRfc21hbGw_min);

        // color_value is usually between 0 and 1.
        color_value = maybe_filtered_color.color.rgb;




            color_value = vec3(color_value.x);


          // Keep the color in bounds of min and max
          color_value = clamp(color_value, layer_Y29sb3JfZmxvYXRfc21hbGw_min, layer_Y29sb3JfZmxvYXRfc21hbGw_max);
          // Scale the color value according to the histogram settings.
          color_value = vec3(
            scaleFloatToFloat(color_value, layer_Y29sb3JfZmxvYXRfc21hbGw_min, layer_Y29sb3JfZmxvYXRfc21hbGw_max)
          );


        color_value = pow(color_value, 1. / vec3(layer_Y29sb3JfZmxvYXRfc21hbGw_gammaCorrectionValue));

        // Maybe invert the color using the inverting_factor
        color_value = abs(color_value - layer_Y29sb3JfZmxvYXRfc21hbGw_is_inverted);
        // Catch the case where max == min would causes a NaN value and use black as a fallback color.
        color_value = mix(color_value, vec3(0.0), is_max_and_min_equal);
        color_value = color_value * layer_Y29sb3JfZmxvYXRfc21hbGw_alpha * layer_Y29sb3JfZmxvYXRfc21hbGw_color;
        // Marking the color as invalid by setting alpha to 0.0 if the fallback color has been used
        // so the fallback color does not cover other colors.
        vec4 layer_color = vec4(color_value, used_fallback ? 0.0 : maybe_filtered_color.color.a * layer_Y29sb3JfZmxvYXRfc21hbGw_alpha);
        // Calculating the color for the current layer depending on blendMode.
        // blendMode == 1.0: Additive, blendMode == 0.0: Cover, blendMode == 2.0: CoverWithBlackAsTransparent
        vec4 additive_color = blendLayersAdditive(data_color, layer_color);
        vec4 cover_color = blendLayersCover(data_color, layer_color, used_fallback);
        vec4 cover_black_transparent_color = blendLayersCoverBlackAsTransparent(data_color, layer_color, used_fallback);
        data_color = mix(cover_color, additive_color, float(blendMode == 1.0));
        data_color = mix(data_color, cover_black_transparent_color, float(blendMode == 2.0));
      }
    }


    float layer_Y29sb3JfdWludDE2_effective_alpha = layer_Y29sb3JfdWludDE2_alpha * (1. - layer_Y29sb3JfdWludDE2_unrenderable);
    if (layer_Y29sb3JfdWludDE2_effective_alpha > 0.) {
      // Get grayscale value for color_uint16


        vec3 layerCoordUVW = transDim((layer_Y29sb3JfdWludDE2_transform * vec4(transDim(worldCoordUVW), 1.0)).xyz);


      if (!isOutsideOfBoundingBox(layerCoordUVW, layer_Y29sb3JfdWludDE2_bboxMin, layer_Y29sb3JfdWludDE2_bboxMax)) {
        MaybeFilteredColor maybe_filtered_color =
          getMaybeFilteredColorOrFallback(
            2.0,
            layer_Y29sb3JfdWludDE2_data_texture_width,
            2.0,
            layerCoordUVW,
            fallbackGray,
            !layer_Y29sb3JfdWludDE2_has_transform
          );
        bool used_fallback = maybe_filtered_color.used_fallback_color;
        float is_max_and_min_equal = float(layer_Y29sb3JfdWludDE2_max == layer_Y29sb3JfdWludDE2_min);

        // color_value is usually between 0 and 1.
        color_value = maybe_filtered_color.color.rgb;




            color_value = vec3(color_value.x);


          // Keep the color in bounds of min and max
          color_value = clamp(color_value, layer_Y29sb3JfdWludDE2_min, layer_Y29sb3JfdWludDE2_max);
          // Scale the color value according to the histogram settings.
          color_value = vec3(
            scaleFloatToFloat(color_value, layer_Y29sb3JfdWludDE2_min, layer_Y29sb3JfdWludDE2_max)
          );


        color_value = pow(color_value, 1. / vec3(layer_Y29sb3JfdWludDE2_gammaCorrectionValue));

        // Maybe invert the color using the inverting_factor
        color_value = abs(color_value - layer_Y29sb3JfdWludDE2_is_inverted);
        // Catch the case where max == min would causes a NaN value and use black as a fallback color.
        color_value = mix(color_value, vec3(0.0), is_max_and_min_equal);
        color_value = color_value * layer_Y29sb3JfdWludDE2_alpha * layer_Y29sb3JfdWludDE2_color;
        // Marking the color as invalid by setting alpha to 0.0 if the fallback color has been used
        // so the fallback color does not cover other colors.
        vec4 layer_color = vec4(color_value, used_fallback ? 0.0 : maybe_filtered_color.color.a * layer_Y29sb3JfdWludDE2_alpha);
        // Calculating the color for the current layer depending on blendMode.
        // blendMode == 1.0: Additive, blendMode == 0.0: Cover, blendMode == 2.0: CoverWithBlackAsTransparent
        vec4 additive_color = blendLayersAdditive(data_color, layer_color);
        vec4 cover_color = blendLayersCover(data_color, layer_color, used_fallback);
        vec4 cover_black_transparent_color = blendLayersCoverBlackAsTransparent(data_color, layer_color, used_fallback);
        data_color = mix(cover_color, additive_color, float(blendMode == 1.0));
        data_color = mix(data_color, cover_black_transparent_color, float(blendMode == 2.0));
      }
    }


    float layer_Y29sb3JfdWludDI0_effective_alpha = layer_Y29sb3JfdWludDI0_alpha * (1. - layer_Y29sb3JfdWludDI0_unrenderable);
    if (layer_Y29sb3JfdWludDI0_effective_alpha > 0.) {
      // Get grayscale value for color_uint24


        vec3 layerCoordUVW = transDim((layer_Y29sb3JfdWludDI0_transform * vec4(transDim(worldCoordUVW), 1.0)).xyz);


      if (!isOutsideOfBoundingBox(layerCoordUVW, layer_Y29sb3JfdWludDI0_bboxMin, layer_Y29sb3JfdWludDI0_bboxMax)) {
        MaybeFilteredColor maybe_filtered_color =
          getMaybeFilteredColorOrFallback(
            3.0,
            layer_Y29sb3JfdWludDI0_data_texture_width,
            1.0,
            layerCoordUVW,
            fallbackGray,
            !layer_Y29sb3JfdWludDI0_has_transform
          );
        bool used_fallback = maybe_filtered_color.used_fallback_color;
        float is_max_and_min_equal = float(layer_Y29sb3JfdWludDI0_max == layer_Y29sb3JfdWludDI0_min);

        // color_value is usually between 0 and 1.
        color_value = maybe_filtered_color.color.rgb;




            color_value *= 255.;


          // Keep the color in bounds of min and max
          color_value = clamp(color_value, layer_Y29sb3JfdWludDI0_min, layer_Y29sb3JfdWludDI0_max);
          // Scale the color value according to the histogram settings.
          color_value = vec3(
            scaleFloatToFloat(color_value, layer_Y29sb3JfdWludDI0_min, layer_Y29sb3JfdWludDI0_max)
          );


        color_value = pow(color_value, 1. / vec3(layer_Y29sb3JfdWludDI0_gammaCorrectionValue));

        // Maybe invert the color using the inverting_factor
        color_value = abs(color_value - layer_Y29sb3JfdWludDI0_is_inverted);
        // Catch the case where max == min would causes a NaN value and use black as a fallback color.
        color_value = mix(color_value, vec3(0.0), is_max_and_min_equal);
        color_value = color_value * layer_Y29sb3JfdWludDI0_alpha * layer_Y29sb3JfdWludDI0_color;
        // Marking the color as invalid by setting alpha to 0.0 if the fallback color has been used
        // so the fallback color does not cover other colors.
        vec4 layer_color = vec4(color_value, used_fallback ? 0.0 : maybe_filtered_color.color.a * layer_Y29sb3JfdWludDI0_alpha);
        // Calculating the color for the current layer depending on blendMode.
        // blendMode == 1.0: Additive, blendMode == 0.0: Cover, blendMode == 2.0: CoverWithBlackAsTransparent
        vec4 additive_color = blendLayersAdditive(data_color, layer_color);
        vec4 cover_color = blendLayersCover(data_color, layer_color, used_fallback);
        vec4 cover_black_transparent_color = blendLayersCoverBlackAsTransparent(data_color, layer_color, used_fallback);
        data_color = mix(cover_color, additive_color, float(blendMode == 1.0));
        data_color = mix(data_color, cover_black_transparent_color, float(blendMode == 2.0));
      }
    }


    float layer_Y29sb3JfdWludDg_effective_alpha = layer_Y29sb3JfdWludDg_alpha * (1. - layer_Y29sb3JfdWludDg_unrenderable);
    if (layer_Y29sb3JfdWludDg_effective_alpha > 0.) {
      // Get grayscale value for color_uint8


        vec3 layerCoordUVW = transDim((layer_Y29sb3JfdWludDg_transform * vec4(transDim(worldCoordUVW), 1.0)).xyz);


      if (!isOutsideOfBoundingBox(layerCoordUVW, layer_Y29sb3JfdWludDg_bboxMin, layer_Y29sb3JfdWludDg_bboxMax)) {
        MaybeFilteredColor maybe_filtered_color =
          getMaybeFilteredColorOrFallback(
            4.0,
            layer_Y29sb3JfdWludDg_data_texture_width,
            4.0,
            layerCoordUVW,
            fallbackGray,
            !layer_Y29sb3JfdWludDg_has_transform
          );
        bool used_fallback = maybe_filtered_color.used_fallback_color;
        float is_max_and_min_equal = float(layer_Y29sb3JfdWludDg_max == layer_Y29sb3JfdWludDg_min);

        // color_value is usually between 0 and 1.
        color_value = maybe_filtered_color.color.rgb;




            color_value = vec3(color_value.x);


          // Keep the color in bounds of min and max
          color_value = clamp(color_value, layer_Y29sb3JfdWludDg_min, layer_Y29sb3JfdWludDg_max);
          // Scale the color value according to the histogram settings.
          color_value = vec3(
            scaleFloatToFloat(color_value, layer_Y29sb3JfdWludDg_min, layer_Y29sb3JfdWludDg_max)
          );


        color_value = pow(color_value, 1. / vec3(layer_Y29sb3JfdWludDg_gammaCorrectionValue));

        // Maybe invert the color using the inverting_factor
        color_value = abs(color_value - layer_Y29sb3JfdWludDg_is_inverted);
        // Catch the case where max == min would causes a NaN value and use black as a fallback color.
        color_value = mix(color_value, vec3(0.0), is_max_and_min_equal);
        color_value = color_value * layer_Y29sb3JfdWludDg_alpha * layer_Y29sb3JfdWludDg_color;
        // Marking the color as invalid by setting alpha to 0.0 if the fallback color has been used
        // so the fallback color does not cover other colors.
        vec4 layer_color = vec4(color_value, used_fallback ? 0.0 : maybe_filtered_color.color.a * layer_Y29sb3JfdWludDg_alpha);
        // Calculating the color for the current layer depending on blendMode.
        // blendMode == 1.0: Additive, blendMode == 0.0: Cover, blendMode == 2.0: CoverWithBlackAsTransparent
        vec4 additive_color = blendLayersAdditive(data_color, layer_color);
        vec4 cover_color = blendLayersCover(data_color, layer_color, used_fallback);
        vec4 cover_black_transparent_color = blendLayersCoverBlackAsTransparent(data_color, layer_color, used_fallback);
        data_color = mix(cover_color, additive_color, float(blendMode == 1.0));
        data_color = mix(data_color, cover_black_transparent_color, float(blendMode == 2.0));
      }
    }

  data_color = clamp(data_color, 0.0, 1.0);
  data_color.a = 1.0;

  gl_FragColor = data_color;


}
