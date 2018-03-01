/**
 * plane_material_factory.js
 * @flow
 */

import _ from "lodash";
import * as THREE from "three";
import Utils from "libs/utils";
import Model from "oxalis/model";
import AbstractPlaneMaterialFactory, {
  sanitizeName,
  createDataTexture,
} from "oxalis/geometries/materials/abstract_plane_material_factory";
import type { TextureMapType } from "oxalis/geometries/materials/abstract_plane_material_factory";
import type { OrthoViewType, Vector3 } from "oxalis/constants";
import type { DatasetLayerConfigurationType } from "oxalis/store";
import type { ShaderMaterialOptionsType } from "oxalis/geometries/materials/abstract_plane_material_factory";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { zoomedAddressToPosition } from "oxalis/model/binary/texture_bucket_manager";
import { OrthoViews } from "oxalis/constants";
import Dimensions from "oxalis/model/dimensions";

const DEFAULT_COLOR = new THREE.Vector3([255, 255, 255]);

class PlaneMaterialFactory extends AbstractPlaneMaterialFactory {
  planeID: OrthoViewType;

  constructor(tWidth: number, textures: TextureMapType, planeID: OrthoViewType) {
    // this.planeID = planeID;
    super(tWidth, textures, planeID);
  }

  setupUniforms(): void {
    super.setupUniforms();

    this.uniforms = _.extend(this.uniforms, {
      repeat: {
        type: "v2",
        value: new THREE.Vector2(1, 1),
      },
      buffer: {
        type: "v2",
        value: new THREE.Vector2(1, 1),
      },
      alpha: {
        type: "f",
        value: 0,
      },
      globalPosition: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
      anchorPoint: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
      fallbackAnchorPoint: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
      zoomStep: {
        type: "f",
        value: 1,
      },
      uvw: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
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

    for (let shaderName of Object.keys(this.textures)) {
      const texture = this.textures[shaderName];
      this.uniforms[`${shaderName}_texture`] = {
        type: "t",
        value: texture,
      };

      if (texture.binaryCategory !== "segmentation") {
        this.uniforms[`${shaderName}_weight`] = {
          type: "f",
          value: 1,
        };
        this.uniforms[`${shaderName}_color`] = {
          type: "v3",
          value: DEFAULT_COLOR,
        };
      }
    }
  }

  makeMaterial(options?: ShaderMaterialOptionsType): void {
    super.makeMaterial(options);

    this.material.setColorInterpolation = interpolation => {
      for (const name of Object.keys(this.textures)) {
        const texture = this.textures[name];
        if (texture.binaryCategory === "color") {
          texture.magFilter = interpolation;
          texture.needsUpdate = true;
        }
      }
    };

    this.material.setScaleParams = ({ buffer, repeat }) => {
      this.uniforms.repeat.value.set(repeat.x, repeat.y);

      this.uniforms.buffer.value.set(...buffer);
    };

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

    this.material.side = THREE.DoubleSide;

    listenToStoreProperty(
      storeState => getRequestLogZoomStep(storeState),
      zoomStep => {
        this.uniforms.zoomStep.value = zoomStep;
      },
    );
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

    return _.template(
      `\
<% _.each(layers, function(name) { %>
  uniform sampler2D <%= name %>_texture;
  uniform sampler2D <%= name %>_lookup_texture;
  uniform sampler2D <%= name %>_fallback_texture;
  uniform sampler2D <%= name %>_lookup_fallback_texture;
  uniform float <%= name %>_maxZoomStep;

  uniform float <%= name %>_brightness;
  uniform float <%= name %>_contrast;
  uniform vec3 <%= name %>_color;
  uniform float <%= name %>_weight;
<% }) %>
<% if (hasSegmentation) { %>
  uniform sampler2D <%= segmentationName %>_texture;
  uniform sampler2D <%= segmentationName %>_lookup_texture;
  uniform sampler2D <%= segmentationName %>_fallback_texture;
  uniform sampler2D <%= segmentationName %>_lookup_fallback_texture;
<% } %>
uniform vec2 repeat, buffer;
uniform float alpha;
uniform vec3 globalPosition;
uniform vec3 anchorPoint;
uniform vec3 fallbackAnchorPoint;
uniform float zoomStep;
uniform vec3 uvw;

varying vec2 vPos;
varying vec2 vUv;

// todo: pass as uniform or from template
const float bucketPerDim = 16.0;
const float bucketWidth = 32.0;
const float bucketLength = bucketWidth * bucketWidth * bucketWidth;
const float r_texture_width = 512.0;
const float d_texture_width = 8192.0;
const float l_texture_width = 64.0;
const float bytesPerLookUpEntry = 1.0;

/* Inspired from: http://lolengine.net/blog/2013/07/27/rgb-to-hsv-in-glsl */
vec3 hsv_to_rgb(vec4 HSV)
{
  vec4 K;
  vec3 p;
  K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  p = abs(fract(HSV.xxx + K.xyz) * 6.0 - K.www);
  return HSV.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), HSV.y);
}

float div(float a, float b) {
  return floor(a / b);
}

float round(float a) {
  return floor(a + 0.5);
}

vec3 getRGBAtIndex(sampler2D texture, float textureWidth, float idx) {
  float finalPosX = mod(idx, textureWidth);
  float finalPosY = div(idx, textureWidth);

  return texture2D(
      texture,
      vec2(
        (floor(finalPosX) + 0.5) / textureWidth,
        (floor(finalPosY) + 0.5) / textureWidth
      )
    ).rgb;
}

vec3 getRGBAtXYIndex(sampler2D texture, float textureWidth, float x, float y) {
  return texture2D(
      texture,
      vec2(
        (floor(x) + 0.5) / textureWidth,
        (floor(y) + 0.5) / textureWidth
      )
    ).rgb;
}

float linearizeVec3ToIndex(vec3 position, float base) {
  return position.z * base * base + position.y * base + position.x;
}

float linearizeVec3ToIndexWithMod(vec3 position, float base, float m) {
  return mod(mod(position.z * base * base, m) + mod(position.y * base, m) + position.x, m);
}

vec3 transDim(vec3 array) {
  <%= (function () {
      switch (planeID) {
        case OrthoViews.PLANE_XY:
          return "return array;";
        case OrthoViews.PLANE_YZ:
          return "return vec3(array.z, array.y, array.x);"; // [2, 1, 0]
        case OrthoViews.PLANE_XZ:
          return "return vec3(array.x, array.z, array.y);"; //[0, 2, 1]"
        default:
          throw new Error("Invalid planeID provided to fragment shader");
      }
    })()
  %>
}

vec3 getColorFor(sampler2D lookUpTexture, sampler2D dataTexture, vec3 bucketPosition, vec3 offsetInBucket) {
  float bucketIdx = linearizeVec3ToIndex(bucketPosition, bucketPerDim);
  float bucketIdxInTexture = bucketIdx * bytesPerLookUpEntry;
  float pixelIdxInBucket = linearizeVec3ToIndex(offsetInBucket, bucketWidth);

  float bucketAddress = getRGBAtIndex(
    lookUpTexture,
    l_texture_width,
    bucketIdxInTexture
  ).x;

  // todo: does this make sense? what happens when there are multiple layers and we are mixing data with non-data?
  if (bucketAddress < 0.) {
    return vec3(0.0, 0.0, 0.0);
  }

  float x = linearizeVec3ToIndexWithMod(offsetInBucket, bucketWidth, d_texture_width);
  float pixelIdxInDataTexture = pixelIdxInBucket + bucketLength * bucketAddress;
  float y = div(pixelIdxInDataTexture, d_texture_width);

  vec3 bucketColor = getRGBAtXYIndex(
    dataTexture,
    d_texture_width,
    x,
    y
  );
  return bucketColor;
}

void main() {
  float golden_ratio = 0.618033988749895;
  float color_value  = 0.0;

  float useFallback = 1.0;
  float usedZoomStep = useFallback == 1.0 ? <%= layers[0]%>_maxZoomStep : zoomStep;
  vec3 usedAnchorPoint = useFallback == 1.0 ? fallbackAnchorPoint : anchorPoint;
  float zoomStepDiff = usedZoomStep - zoomStep;
  float zoomFactor = pow(2.0, zoomStep + 5.0 + zoomStepDiff);

  vec2 globalPositionUV = vec2(
    globalPosition[<%= uvw[0] %>],
    globalPosition[<%= uvw[1] %>]
  );
  // Offset to bucket boundary (only consider the first k bits by subtracting the "floored" value)
  vec2 unscaledOffset = globalPositionUV - floor(globalPositionUV / zoomFactor) * zoomFactor;

  vec2 offset = buffer / 2.0 + unscaledOffset / pow(2.0, zoomStep);
  offset.y = offset.y + repeat.y * r_texture_width;
  offset = offset / r_texture_width;
  offset.y = 1.0 - offset.y;

  vec2 texture_pos = vUv * repeat + offset;
  // Mirror y since (0, 0) refers to the lower-left corner in WebGL instead of the upper-left corner
  texture_pos = vec2(texture_pos.x, 1.0 - texture_pos.y);

  float upsamplingFactor = pow(2.0, zoomStepDiff);
  float upsamplingOffset = 0.5 - 0.5 / upsamplingFactor; // 0.25 for zoomStepDiff == 1
  texture_pos.x = texture_pos.x / upsamplingFactor + upsamplingOffset;
  texture_pos.y = texture_pos.y / upsamplingFactor + upsamplingOffset;

  vec3 coords = transDim(vec3(
    floor(texture_pos.x * (r_texture_width * 0.99999)),
    floor(texture_pos.y * (r_texture_width * 0.99999)),
    floor((globalPosition[<%= uvw[2] %>] - usedAnchorPoint[<%= uvw[2] %>] * pow(2.0, 5.0 + usedZoomStep)) / pow(2.0, usedZoomStep))
  ));

  vec3 bucketPosition = vec3(
    div(coords.x, bucketWidth),
    div(coords.y, bucketWidth),
    div(coords.z, bucketWidth)
  );
  vec3 offsetInBucket = vec3(
    mod(coords.x, bucketWidth),
    mod(coords.y, bucketWidth),
    mod(coords.z, bucketWidth)
  );

  <% if (hasSegmentation) { %>
    // todo: test
    vec3 volume_color = getColorFor(<%= segmentationName %>_lookup_fallback_texture, <%= segmentationName %>_fallback_texture, bucketPosition, offsetInBucket).xyz;
    // vec4 volume_color = texture2D(<%= segmentationName %>_texture, texture_pos);
    float id = (volume_color.r * 255.0);
  <% } else { %>
    float id = 0.0;
  <% } %>

  // Get Color Value(s)
  <% if (isRgb) { %>
    // todo: data texture needs to be rgb
    vec3 data_color = getColorFor( <%= layers[0] %>_lookup_texture, <%= layers[0] %>_texture, bucketPosition, offsetInBucket).xyz;
    data_color = (data_color + <%= layers[0] %>_brightness - 0.5) * <%= layers[0] %>_contrast + 0.5;
  <% } else { %>
    vec3 data_color = vec3(0.0, 0.0, 0.0);
    <% _.each(layers, function(name){ %>
      // Get grayscale value for <%= name %>
      color_value =
        useFallback == 0.0
          ? getColorFor(<%= name %>_lookup_texture, <%= name %>_texture, bucketPosition, offsetInBucket).x
          : getColorFor(<%= name %>_lookup_fallback_texture, <%= name %>_fallback_texture, bucketPosition, offsetInBucket).x;

      // Brightness / Contrast Transformation for <%= name %>
      color_value = (color_value + <%= name %>_brightness - 0.5) * <%= name %>_contrast + 0.5;

      // Multiply with color and weight for <%= name %>
      data_color += color_value * <%= name %>_weight * <%= name %>_color;
    <% }) %> ;
    data_color = clamp(data_color, 0.0, 1.0);
  <% } %>

  // Color map (<= to fight rounding mistakes)
  if ( id > 0.1 ) {
    vec4 HSV = vec4( mod( id * golden_ratio, 1.0), 1.0, 1.0, 1.0 );
    gl_FragColor = vec4(mix( data_color, hsv_to_rgb(HSV), alpha ), 1.0);
  } else {
    gl_FragColor = vec4(data_color, 1.0);
  }

  // gl_FragColor = vec4(bucketAddress / pow(12.0, 2.0), 0.0, 0.0, 1.0);
  // gl_FragColor = vec4(pixelIdxInBucket / pow(32.0, 2.0), 0.0, 0.0, 1.0);
  // gl_FragColor = vec4(texture_pos.x, texture_pos.y, 0.0, 1.0);
}


\
`,
    )({
      layers: colorLayerNames,
      hasSegmentation: segmentationBinary != null,
      segmentationName: sanitizeName(segmentationBinary ? segmentationBinary.name : ""),
      isRgb: Utils.__guard__(Model.binary.color, x1 => x1.targetBitDepth) === 24,
      OrthoViews,
      planeID: this.planeID,
      uvw: Dimensions.getIndices(this.planeID),
    });
  }
}

export default PlaneMaterialFactory;
