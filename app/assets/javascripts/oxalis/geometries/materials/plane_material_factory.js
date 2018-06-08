/**
 * plane_material_factory.js
 * @flow
 */

import _ from "lodash";
import * as THREE from "three";
import Utils from "libs/utils";
import Model from "oxalis/model";
import Store from "oxalis/store";
import AbstractPlaneMaterialFactory, {
  sanitizeName,
} from "oxalis/geometries/materials/abstract_plane_material_factory";
import type {
  ShaderMaterialOptionsType,
  TextureMapType,
} from "oxalis/geometries/materials/abstract_plane_material_factory";
import type { OrthoViewType, Vector3 } from "oxalis/constants";
import type { DatasetLayerConfigurationType } from "oxalis/store";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import {
  getPlaneScalingFactor,
  getRequestLogZoomStep,
} from "oxalis/model/accessors/flycam_accessor";
import constants, {
  OrthoViews,
  OrthoViewValues,
  OrthoViewIndices,
  ModeValues,
  ModeValuesIndices,
  VolumeToolEnum,
  volumeToolEnumToIndex,
} from "oxalis/constants";
import { floatsPerLookUpEntry } from "oxalis/model/binary/texture_bucket_manager";
import { MAPPING_TEXTURE_WIDTH } from "oxalis/model/binary/mappings";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { getActiveCellId, getVolumeTool } from "oxalis/model/accessors/volumetracing_accessor";
import { getPackingDegree } from "oxalis/model/binary/data_rendering_logic";

const DEFAULT_COLOR = new THREE.Vector3([255, 255, 255]);

function formatNumberAsGLSLFloat(aNumber: number): string {
  if (aNumber % 1 > 0) {
    // If it is already a floating point number, we can use toString
    return aNumber.toString();
  } else {
    // Otherwise, append ".0" via toFixed
    return aNumber.toFixed(1);
  }
}

class PlaneMaterialFactory extends AbstractPlaneMaterialFactory {
  planeID: OrthoViewType;

  constructor(planeID: OrthoViewType, shaderId: number) {
    super(shaderId);
    this.planeID = planeID;
  }

  setupUniforms(): void {
    super.setupUniforms();

    this.uniforms = _.extend(this.uniforms, {
      alpha: {
        type: "f",
        value: 0,
      },
      highlightHoveredCellId: {
        type: "b",
        value: true,
      },
      sphericalCapRadius: {
        type: "f",
        value: 140,
      },
      globalPosition: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
      anchorPoint: {
        type: "v4",
        value: new THREE.Vector3(0, 0, 0),
      },
      fallbackAnchorPoint: {
        type: "v4",
        value: new THREE.Vector3(0, 0, 0),
      },
      zoomStep: {
        type: "f",
        value: 1,
      },
      zoomValue: {
        type: "f",
        value: 1,
      },
      useBilinearFiltering: {
        type: "b",
        value: true,
      },
      isMappingEnabled: {
        type: "b",
        value: false,
      },
      mappingSize: {
        type: "f",
        value: 0,
      },
      globalMousePosition: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
      brushSizeInPixel: {
        type: "f",
        value: 0,
      },
      pixelToVoxelFactor: {
        type: "f",
        value: 0,
      },
      activeCellId: {
        type: "v4",
        value: new THREE.Vector4(0, 0, 0, 0),
      },
      isMouseInActiveViewport: {
        type: "b",
        value: false,
      },
      isMouseInCanvas: {
        type: "b",
        value: false,
      },
      activeVolumeToolIndex: {
        type: "f",
        value: 0,
      },
      viewMode: {
        type: "f",
        value: 0,
      },
      planeID: {
        type: "f",
        value: OrthoViewValues.indexOf(this.planeID),
      },
    });

    for (const name of Object.keys(Model.binary)) {
      const binary = Model.binary[name];
      this.uniforms[sanitizeName(`${name}_maxZoomStep`)] = {
        type: "f",
        value: binary.cube.MAX_ZOOM_STEP,
      };
    }
  }

  convertColor(color: Vector3): Vector3 {
    return [color[0] / 255, color[1] / 255, color[2] / 255];
  }

  attachTextures(textures: TextureMapType): void {
    // create textures
    this.textures = textures;

    // Add data and look up textures for each layer
    for (const name of Object.keys(Model.binary)) {
      const binary = Model.binary[name];
      const [lookUpTexture, ...dataTextures] = binary.getDataTextures();

      this.uniforms[`${sanitizeName(name)}_textures`] = {
        type: "tv",
        value: dataTextures,
      };

      this.uniforms[`${sanitizeName(name)}_data_texture_width`] = {
        type: "f",
        value: binary.textureWidth,
      };

      this.uniforms[sanitizeName(`${name}_lookup_texture`)] = {
        type: "t",
        value: lookUpTexture,
      };
    }

    // Add mapping
    const segmentationBinary = Model.getSegmentationBinary();
    if (segmentationBinary != null && Model.isMappingSupported) {
      const [
        mappingTexture,
        mappingLookupTexture,
      ] = Model.getSegmentationBinary().mappings.getMappingTextures();
      this.uniforms[sanitizeName(`${Model.getSegmentationBinary().name}_mapping_texture`)] = {
        type: "t",
        value: mappingTexture,
      };
      this.uniforms[
        sanitizeName(`${Model.getSegmentationBinary().name}_mapping_lookup_texture`)
      ] = {
        type: "t",
        value: mappingLookupTexture,
      };
    }

    // Add weight/color uniforms
    const colorLayerNames = _.map(Model.getColorBinaries(), b => sanitizeName(b.name));
    for (const name of colorLayerNames) {
      this.uniforms[`${name}_weight`] = {
        type: "f",
        value: 1,
      };
      this.uniforms[`${name}_color`] = {
        type: "v3",
        value: DEFAULT_COLOR,
      };
    }
  }

  makeMaterial(options?: ShaderMaterialOptionsType): void {
    super.makeMaterial(options);

    this.material.setGlobalPosition = ([x, y, z]) => {
      this.uniforms.globalPosition.value.set(x, y, z);
    };

    this.material.setAnchorPoint = ([x, y, z]) => {
      this.uniforms.anchorPoint.value.set(x, y, z);
    };

    this.material.setFallbackAnchorPoint = ([x, y, z]) => {
      this.uniforms.fallbackAnchorPoint.value.set(x, y, z);
    };

    this.material.setSegmentationAlpha = alpha => {
      this.uniforms.alpha.value = alpha / 100;
    };

    this.material.setUseBilinearFiltering = isEnabled => {
      this.uniforms.useBilinearFiltering.value = isEnabled;
    };

    this.material.setIsMappingEnabled = isMappingEnabled => {
      this.uniforms.isMappingEnabled.value = isMappingEnabled;
    };

    this.material.side = THREE.DoubleSide;

    listenToStoreProperty(
      storeState => getRequestLogZoomStep(storeState),
      zoomStep => {
        this.uniforms.zoomStep.value = zoomStep;
      },
      true,
    );

    listenToStoreProperty(
      storeState => storeState.userConfiguration.sphericalCapRadius,
      sphericalCapRadius => {
        this.uniforms.sphericalCapRadius.value = sphericalCapRadius;
      },
      true,
    );

    listenToStoreProperty(
      storeState => storeState.flycam.zoomStep,
      zoomStep => {
        this.uniforms.zoomValue.value = zoomStep;
      },
      true,
    );

    listenToStoreProperty(
      storeState => storeState.temporaryConfiguration.activeMapping.mappingSize,
      mappingSize => {
        this.uniforms.mappingSize.value = mappingSize;
      },
      true,
    );

    listenToStoreProperty(
      storeState => storeState.temporaryConfiguration.viewMode,
      viewMode => {
        this.uniforms.viewMode.value = ModeValues.indexOf(viewMode);
      },
      true,
    );

    listenToStoreProperty(
      storeState => getPlaneScalingFactor(storeState.flycam) / storeState.userConfiguration.scale,
      pixelToVoxelFactor => {
        this.uniforms.pixelToVoxelFactor.value = pixelToVoxelFactor;
      },
      true,
    );

    listenToStoreProperty(
      storeState => storeState.viewModeData.plane.activeViewport === this.planeID,
      isMouseInActiveViewport => {
        this.uniforms.isMouseInActiveViewport.value = isMouseInActiveViewport;
      },
      true,
    );

    listenToStoreProperty(
      storeState => storeState.datasetConfiguration.highlightHoveredCellId,
      highlightHoveredCellId => {
        this.uniforms.highlightHoveredCellId.value = highlightHoveredCellId;
      },
      true,
    );

    const segmentationBinary = Model.getSegmentationBinary();
    const hasSegmentation = segmentationBinary != null;

    if (hasSegmentation) {
      listenToStoreProperty(
        storeState => storeState.temporaryConfiguration.mousePosition,
        globalMousePosition => {
          if (!globalMousePosition) {
            this.uniforms.isMouseInCanvas.value = false;
            return;
          }
          if (Store.getState().viewModeData.plane.activeViewport === OrthoViews.TDView) {
            return;
          }

          const [x, y, z] = calculateGlobalPos({
            x: globalMousePosition[0],
            y: globalMousePosition[1],
          });
          this.uniforms.globalMousePosition.value.set(x, y, z);
          this.uniforms.isMouseInCanvas.value = true;
        },
        true,
      );

      listenToStoreProperty(
        storeState => storeState.temporaryConfiguration.brushSize,
        brushSize => {
          this.uniforms.brushSizeInPixel.value = brushSize;
        },
        true,
      );

      listenToStoreProperty(
        storeState => getActiveCellId(storeState.tracing).getOrElse(0),
        () => this.updateActiveCellId(),
        true,
      );

      listenToStoreProperty(
        storeState => storeState.temporaryConfiguration.activeMapping.isMappingEnabled,
        () => this.updateActiveCellId(),
      );

      listenToStoreProperty(
        storeState => storeState.temporaryConfiguration.activeMapping.mapping,
        () => this.updateActiveCellId(),
      );

      listenToStoreProperty(
        storeState => volumeToolEnumToIndex(Utils.toNullable(getVolumeTool(storeState.tracing))),
        volumeTool => {
          this.uniforms.activeVolumeToolIndex.value = volumeTool;
        },
        true,
      );
    }
  }

  updateActiveCellId() {
    const activeCellId = getActiveCellId(Store.getState().tracing).getOrElse(0);
    const mappedActiveCellId = Model.getSegmentationBinary().cube.mapId(activeCellId);
    // Convert the id into 4 bytes (little endian)
    const [a, b, g, r] = Utils.convertDecToBase256(mappedActiveCellId);
    this.uniforms.activeCellId.value.set(r, g, b, a);
  }

  updateUniformsForLayer(settings: DatasetLayerConfigurationType, name: string): void {
    super.updateUniformsForLayer(settings, name);

    if (settings.color != null) {
      const color = this.convertColor(settings.color);
      this.uniforms[`${name}_color`].value = new THREE.Vector3(...color);
    }
  }

  getFragmentShader(): string {
    const colorLayerNames = _.map(Model.getColorBinaries(), b => sanitizeName(b.name));
    const segmentationBinary = Model.getSegmentationBinary();
    const segmentationName = sanitizeName(segmentationBinary ? segmentationBinary.name : "");
    const datasetScale = Store.getState().dataset.dataSource.scale;
    const hasSegmentation = segmentationBinary != null;

    const segmentationPackingDegree = hasSegmentation
      ? getPackingDegree(segmentationBinary.getByteCount())
      : 0;

    return _.template(
      `\
precision highp float;
const int dataTextureCountPerLayer = <%= dataTextureCountPerLayer %>;

<% _.each(layers, function(name) { %>
  uniform sampler2D <%= name %>_textures[dataTextureCountPerLayer];
  uniform float <%= name %>_data_texture_width;
  uniform sampler2D <%= name %>_lookup_texture;
  uniform float <%= name %>_maxZoomStep;
  uniform float <%= name %>_brightness;
  uniform float <%= name %>_contrast;
  uniform vec3 <%= name %>_color;
  uniform float <%= name %>_weight;
<% }) %>

<% if (hasSegmentation) { %>
  uniform vec4 activeCellId;
  uniform bool isMouseInActiveViewport;
  uniform float activeVolumeToolIndex;
  uniform sampler2D <%= segmentationName %>_lookup_texture;
  uniform sampler2D <%= segmentationName %>_textures[dataTextureCountPerLayer];
  uniform float <%= segmentationName %>_data_texture_width;
  uniform float <%= segmentationName %>_maxZoomStep;

  <% if (isMappingSupported) { %>
    uniform bool isMappingEnabled;
    uniform float mappingSize;
    uniform sampler2D <%= segmentationName %>_mapping_texture;
    uniform sampler2D <%= segmentationName %>_mapping_lookup_texture;
  <% } %>
<% } %>

uniform float sphericalCapRadius;
uniform float viewMode;
uniform float alpha;
uniform bool highlightHoveredCellId;
uniform vec3 globalPosition;
uniform vec3 anchorPoint;
uniform vec3 fallbackAnchorPoint;
uniform float zoomStep;
uniform float zoomValue;
uniform vec3 uvw;
uniform bool useBilinearFiltering;
uniform vec3 globalMousePosition;
uniform bool isMouseInCanvas;
uniform float brushSizeInPixel;
uniform float pixelToVoxelFactor;
uniform float planeID;

varying vec4 worldCoord;
varying vec4 modelCoord;
varying mat4 savedModelMatrix;

const float bucketsPerDim = <%= bucketsPerDim %>;
const float bucketWidth = <%= bucketWidth %>;
const float bucketSize = <%= bucketSize %>;
const float l_texture_width = <%= l_texture_width %>;
const float floatsPerLookUpEntry = <%= floatsPerLookUpEntry %>;

// For some reason, taking the dataset scale from the uniform results is imprecise
// rendering of the brush circle (and issues in the arbitrary modes). That's why it
// is directly inserted into the source via templating.
const vec3 datasetScale = <%= formatVector3AsVec3(datasetScale) %>;

const vec4 fallbackGray = vec4(0.5, 0.5, 0.5, 1.0);

/* Inspired from: http://lolengine.net/blog/2013/07/27/rgb-to-hsv-in-glsl */
vec3 hsv_to_rgb(vec4 HSV)
{
  vec4 K;
  vec3 p;
  K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  p = abs(fract(HSV.xxx + K.xyz) * 6.0 - K.www);
  return HSV.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), HSV.y);
}

// https://github.com/glslify/glsl-inverse/blob/master/index.glsl
mat4 inverse(mat4 m) {
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

float round(float a) {
  return floor(a + 0.5);
}

vec3 round(vec3 a) {
  return floor(a + 0.5);
}

vec4 round(vec4 a) {
  return floor(a + 0.5);
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
      else {
        return vec4(0.5, 0.0, 0.0, 0.0);
      }
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
}


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

vec4 getRgbaAtXYIndex(sampler2D texture, float textureWidth, float x, float y) {
  return texture2D(
      texture,
      vec2(
        (floor(x) + 0.5) / textureWidth,
        (floor(y) + 0.5) / textureWidth
      )
    ).rgba;
}

// E.g., the vector [9, 5, 2]  will be linearized to the scalar index 900 + 50 + 2, when base == 10
float linearizeVec3ToIndex(vec3 position, float base) {
  return position.z * base * base + position.y * base + position.x;
}

// Same as linearizeVec3ToIndex. However, a mod parameter m can be passed when the final index
// is going to be modded, anyway. This circumvents floating overflows by modding the intermediary results.
float linearizeVec3ToIndexWithMod(vec3 position, float base, float m) {
  return mod(mod(position.z * base * base, m) + mod(position.y * base, m) + position.x, m);
}

// Similar to the transDim function in dimensions.js, this function transposes dimensions for the current plane.
vec3 transDim(vec3 array) {
  if (planeID == <%= OrthoViewIndices.PLANE_XY %>) {
    return array;
  } else if (planeID == <%= OrthoViewIndices.PLANE_YZ %>) {
    return vec3(array.z, array.y, array.x); // [2, 1, 0]
  } else if (planeID == <%= OrthoViewIndices.PLANE_XZ %>) {
    return vec3(array.x, array.z, array.y); // [0, 2, 1]
  }
}

bool isNan(float val) {
  // https://stackoverflow.com/questions/9446888/best-way-to-detect-nans-in-opengl-shaders
  return !(val < 0.0 || 0.0 < val || val == 0.0);
  // important: some nVidias failed to cope with version below.
  // Probably wrong optimization.
  /*return ( val <= 0.0 || 0.0 <= val ) ? false : true;*/
}

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
    return vec4(vec3(bucketColor.r), 1.0);
  } else if (rgbaIndex == 1.0) {
    return vec4(vec3(bucketColor.g), 1.0);
  } else if (rgbaIndex == 2.0) {
    return vec4(vec3(bucketColor.b), 1.0);
  } else if (rgbaIndex == 3.0) {
    return vec4(vec3(bucketColor.a), 1.0);
  }
}

vec3 getResolution(float zoomStep) {
  if (zoomStep == 0.0) {
    return <%= formatVector3AsVec3(resolutions[0]) %>;
  } <% _.range(1, resolutions.length).forEach(resolutionIdx => { %>
  else if (zoomStep == <%= formatNumberAsGLSLFloat(resolutionIdx) %>) {
    return <%= formatVector3AsVec3(resolutions[resolutionIdx]) %>;
  }
  <% }) %>
  else {
    return vec3(0.0, 0.0, 0.0);
  }
}

vec3 getRelativeCoords(vec3 worldCoordUVW, float usedZoomStep) {
  float zoomStepDiff = usedZoomStep - zoomStep;
  bool useFallback = zoomStepDiff > 0.0;
  vec3 usedAnchorPoint = useFallback ? fallbackAnchorPoint : anchorPoint;
  vec3 usedAnchorPointUVW = transDim(usedAnchorPoint);

  vec3 resolution = getResolution(usedZoomStep);
  float zoomValue = pow(2.0, usedZoomStep);

  vec3 resolutionUVW = transDim(resolution);
  vec3 anchorPointAsGlobalPositionUVW =
    usedAnchorPointUVW * resolutionUVW * bucketWidth;
  vec3 relativeCoords = (worldCoordUVW - anchorPointAsGlobalPositionUVW) / resolutionUVW;

  vec3 coords = transDim(relativeCoords);

  return coords;
}

bool isArbitrary() {
  return viewMode == <%= ModeValuesIndices.Flight %> || viewMode == <%= ModeValuesIndices.Oblique %>;
}

bool isFlightMode() {
  return viewMode == <%= ModeValuesIndices.Flight %>;
}

float getW(vec3 vector) {
  if (planeID == <%= OrthoViewIndices.PLANE_XY %>) {
    return vector[2];
  } else if (planeID == <%= OrthoViewIndices.PLANE_YZ %>) {
    return vector[0];
  } else if (planeID == <%= OrthoViewIndices.PLANE_XZ %>) {
    return vector[1];
  }
}

vec3 getWorldCoordUVW() {
  vec3 worldCoordUVW = transDim(worldCoord.xyz);

  if (isFlightMode()) {
    vec4 modelCoords = inverse(savedModelMatrix) * worldCoord;
    float sphericalRadius = sphericalCapRadius;

    vec4 centerVertex = vec4(0.0, 0.0, -sphericalRadius, 0.0);
    modelCoords.z = 0.0;
    modelCoords += centerVertex;
    modelCoords.xyz = modelCoords.xyz * (sphericalRadius / length(modelCoords.xyz));
    modelCoords -= centerVertex;

    worldCoordUVW = (savedModelMatrix * modelCoords).xyz;
  }

  vec3 datasetScaleUVW = transDim(datasetScale);

  worldCoordUVW = vec3(
    // For u and w we need to divide by datasetScale because the threejs scene is scaled
    worldCoordUVW.x / datasetScaleUVW.x,
    worldCoordUVW.y / datasetScaleUVW.y,

    // In orthogonal mode, the planes are offset in 3D space to allow skeletons to be rendered before
    // each plane. Since w (e.g., z for xy plane) is
    // the same for all texels computed in this shader, we simply use globalPosition[w] instead
    isArbitrary() ?
      worldCoordUVW.z / datasetScaleUVW.z
      : getW(globalPosition)
  );

  return worldCoordUVW;
}

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

vec4 getBilinearColorFor(
  sampler2D lookUpTexture,
  float layerIndex,
  float d_texture_width,
  float packingDegree,
  vec3 coords,
  float isFallback
) {
  coords = coords + transDim(vec3(-0.5, -0.5, 0.0));
  vec2 bifilteringParams = transDim((coords - floor(coords))).xy;
  coords = floor(coords);

  vec4 a = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords, isFallback);
  vec4 b = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords + transDim(vec3(1, 0, 0)), isFallback);
  vec4 c = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords + transDim(vec3(0, 1, 0)), isFallback);
  vec4 d = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords + transDim(vec3(1, 1, 0)), isFallback);
  if (a.a < 0.0 || b.a < 0.0 || c.a < 0.0 || d.a < 0.0) {
    // We need to check all four colors for a negative parts, because there will be black
    // lines at the borders otherwise (black gets mixed with data)
    return vec4(0.0, 0.0, 0.0, -1.0);
  }

  vec4 ab = mix(a, b, bifilteringParams.x);
  vec4 cd = mix(c, d, bifilteringParams.x);

  return mix(ab, cd, bifilteringParams.y);
}

vec4 getTrilinearColorFor(
  sampler2D lookUpTexture,
  float layerIndex,
  float d_texture_width,
  float packingDegree,
  vec3 coords,
  float isFallback
) {
  coords = coords + transDim(vec3(-0.5, -0.5, 0.0));
  vec3 bifilteringParams = transDim((coords - floor(coords))).xyz;
  coords = floor(coords);

  vec4 a = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords, isFallback);
  vec4 b = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords + transDim(vec3(1, 0, 0)), isFallback);
  vec4 c = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords + transDim(vec3(0, 1, 0)), isFallback);
  vec4 d = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords + transDim(vec3(1, 1, 0)), isFallback);

  vec4 a2 = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords + transDim(vec3(0, 0, 1)), isFallback);
  vec4 b2 = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords + transDim(vec3(1, 0, 1)), isFallback);
  vec4 c2 = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords + transDim(vec3(0, 1, 1)), isFallback);
  vec4 d2 = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords + transDim(vec3(1, 1, 1)), isFallback);

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


vec4 getMaybeFilteredColor(
  sampler2D lookUpTexture,
  float layerIndex,
  float d_texture_width,
  float packingDegree,
  vec3 coords,
  bool suppressBilinearFiltering,
  float isFallback
) {
  vec4 color;
  if (!suppressBilinearFiltering && useBilinearFiltering) {
    if (isArbitrary()) {
      color = getTrilinearColorFor(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords, isFallback);
    } else {
      color = getBilinearColorFor(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords, isFallback);
    }
  } else {
    color = getColorForCoords(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords, isFallback);
  }
  return color;
}

vec4 getMaybeFilteredColorOrFallback(
  sampler2D lookUpTexture,
  float layerIndex,
  float d_texture_width,
  float packingDegree,
  vec3 coords,
  vec3 fallbackCoords,
  bool hasFallback,
  bool suppressBilinearFiltering,
  vec4 fallbackColor
) {
  vec4 color = getMaybeFilteredColor(lookUpTexture, layerIndex, d_texture_width, packingDegree, coords, suppressBilinearFiltering, 0.0);

  if (color.a < 0.0 && hasFallback) {
    color = getMaybeFilteredColor(lookUpTexture, layerIndex, d_texture_width, packingDegree, fallbackCoords, suppressBilinearFiltering, 1.0).rgba;
    if (color.a < 0.0) {
      // Render gray for not-yet-existing data
      color = fallbackColor;
    }
  }

  return color;
}

// Be careful! Floats higher than 2**24 cannot be expressed precisely.
float vec4ToFloat(vec4 v) {
  v *= 255.0;
  return v.r + v.g * pow(2.0, 8.0) + v.b * pow(2.0, 16.0) + v.a * pow(2.0, 24.0);
}

bool greaterThanVec4(vec4 x, vec4 y) {
  if (x.a > y.a) return true;
  if (x.a < y.a) return false;
  if (x.b > y.b) return true;
  if (x.b < y.b) return false;
  if (x.g > y.g) return true;
  if (x.g < y.g) return false;
  if (x.r > y.r) return true;
  else return false;
}

float binarySearchIndex(sampler2D texture, float maxIndex, vec4 value) {
  float low = 0.0;
  float high = maxIndex - 1.0;
  // maxIndex is at most MAPPING_TEXTURE_WIDTH**2, requiring a maximum of log2(MAPPING_TEXTURE_WIDTH**2)+1 loop passes
  for (float i = 0.0; i < <%= formatNumberAsGLSLFloat(Math.log2(mappingTextureWidth**2) + 1.0) %>; i++) {
    float mid = floor((low + high) / 2.0);
    vec4 cur = getRgbaAtIndex(texture, <%= mappingTextureWidth %>, mid);
    if (cur == value) {
      return mid;
    } else if (greaterThanVec4(cur, value)) {
      high = mid - 1.0;
    } else {
      low = mid + 1.0;
    }
  }
  return -1.0;
}

<% if (hasSegmentation) { %>

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
        }
      }
    <% } %>

    return volume_color * 255.0;
  }
<% } %>


vec3 convertCellIdToRGB(vec4 id) {
  float golden_ratio = 0.618033988749895;
  float lastEightBits = id.r;
  vec4 HSV = vec4( mod( lastEightBits * golden_ratio, 1.0), 1.0, 1.0, 1.0 );
  return hsv_to_rgb(HSV);
}

void main() {
  float color_value  = 0.0;

  vec3 worldCoordUVW = getWorldCoordUVW();
  vec3 coords = getRelativeCoords(worldCoordUVW, zoomStep);

  vec3 bucketPosition = div(floor(coords), bucketWidth);
  vec3 offsetInBucket = mod(floor(coords), bucketWidth);

  float fallbackZoomStep = min(<%= layers[0]%>_maxZoomStep, zoomStep + 1.0);
  bool hasFallback = fallbackZoomStep > zoomStep;
  vec3 fallbackCoords = floor(getRelativeCoords(worldCoordUVW, fallbackZoomStep));

  <% if (hasSegmentation) { %>
    vec4 id = getSegmentationId(coords, fallbackCoords, hasFallback);

    vec3 flooredMousePosUVW = transDim(floor(globalMousePosition));
    vec3 mousePosCoords = getRelativeCoords(flooredMousePosUVW, zoomStep);

    vec4 cellIdUnderMouse = getSegmentationId(mousePosCoords, fallbackCoords, false);
  <% } else { %>
    vec4 id = vec4(0.0);
    vec4 cellIdUnderMouse = vec4(0.0);
  <% } %>

  // Get Color Value(s)
  <% if (isRgb) { %>
    vec3 data_color =
      getMaybeFilteredColorOrFallback(
        <%= layers[0] %>_lookup_texture,
        0.0, // layerIndex
        <%= layers[0] %>_data_texture_width,
        1.0,
        coords,
        fallbackCoords,
        hasFallback,
        false,
        fallbackGray
      ).xyz;

    data_color = (data_color + <%= layers[0] %>_brightness - 0.5) * <%= layers[0] %>_contrast + 0.5;
  <% } else { %>
    vec3 data_color = vec3(0.0, 0.0, 0.0);
    <% _.each(layers, function(name, layerIndex){ %>
      // Get grayscale value for <%= name %>
      color_value =
        getMaybeFilteredColorOrFallback(
          <%= name %>_lookup_texture,
          <%= formatNumberAsGLSLFloat(layerIndex) %>,
          <%= name %>_data_texture_width,
          4.0, // gray scale data is always packed into rgba channels
          coords,
          fallbackCoords,
          hasFallback,
          false,
          fallbackGray
        ).x;

      // Brightness / Contrast Transformation for <%= name %>
      color_value = (color_value + <%= name %>_brightness - 0.5) * <%= name %>_contrast + 0.5;

      // Multiply with color and weight for <%= name %>
      data_color += color_value * <%= name %>_weight * <%= name %>_color;
    <% }) %> ;
    data_color = clamp(data_color, 0.0, 1.0);
  <% } %>

  // Color map (<= to fight rounding mistakes)
  if ( length(id) > 0.1 ) {
    // Increase cell opacity when cell is hovered
    float hoverAlphaIncrement =
      // Hover cell only if it's the active one, if the feature is enabled
      // and if segmentation opacity is not zero
      cellIdUnderMouse == id && highlightHoveredCellId && alpha > 0.0
        ? 0.2 : 0.0;
    gl_FragColor = vec4(mix( data_color, convertCellIdToRGB(id), alpha + hoverAlphaIncrement ), 1.0);
  } else {
    gl_FragColor = vec4(data_color, 1.0);
  }

  <% if (hasSegmentation) { %>
    vec4 brushOverlayColor = getBrushOverlay(worldCoordUVW);
    brushOverlayColor.xyz = convertCellIdToRGB(activeCellId);
    gl_FragColor = mix(gl_FragColor, brushOverlayColor, brushOverlayColor.a);
  <% } %>
}


\
`,
    )({
      layerNamesWithSegmentation: colorLayerNames.concat(hasSegmentation ? [segmentationName] : []),
      // Since we concat the segmentation to the color layers, its index is equal
      // to the length of the colorLayer array
      segmentationLayerIndex: colorLayerNames.length,
      layers: colorLayerNames,
      hasSegmentation,
      segmentationName,
      segmentationPackingDegree: formatNumberAsGLSLFloat(segmentationPackingDegree),
      isRgb: Utils.__guard__(Model.binary.color, x1 => x1.targetBitDepth) === 24,
      OrthoViews,
      OrthoViewIndices: _.mapValues(OrthoViewIndices, formatNumberAsGLSLFloat),
      ModeValuesIndices: _.mapValues(ModeValuesIndices, formatNumberAsGLSLFloat),
      bucketsPerDim: formatNumberAsGLSLFloat(constants.MAXIMUM_NEEDED_BUCKETS_PER_DIMENSION),
      l_texture_width: formatNumberAsGLSLFloat(constants.LOOK_UP_TEXTURE_WIDTH),
      isMappingSupported: Model.isMappingSupported,
      dataTextureCountPerLayer: Model.maximumDataTextureCountForLayer,
      mappingTextureWidth: formatNumberAsGLSLFloat(MAPPING_TEXTURE_WIDTH),
      bucketWidth: formatNumberAsGLSLFloat(constants.BUCKET_WIDTH),
      bucketSize: formatNumberAsGLSLFloat(constants.BUCKET_SIZE),
      floatsPerLookUpEntry: formatNumberAsGLSLFloat(floatsPerLookUpEntry),
      formatNumberAsGLSLFloat,
      formatVector3AsVec3: vector3 => `vec3(${vector3.map(formatNumberAsGLSLFloat).join(", ")})`,
      resolutions: Model.getResolutions(),
      datasetScale,
      brushToolIndex: formatNumberAsGLSLFloat(volumeToolEnumToIndex(VolumeToolEnum.BRUSH)),
    });
  }
}

export default PlaneMaterialFactory;
