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
      offset: {
        type: "v2",
        value: new THREE.Vector2(0, 0),
      },
      repeat: {
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
      zoomStep: {
        type: "f",
        value: 1,
      },
      uvw: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      }
    });
  }

  convertColor(color: Vector3): Vector3 {
    return [color[0] / 255, color[1] / 255, color[2] / 255];
  }

  attachTextures(textures: TextureMapType): void {
    // create textures
    this.textures = textures;

    // debugger;

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
    console.log("uniforms", this.uniforms);
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

    this.material.setScaleParams = ({ offset, repeat }) => {
      this.uniforms.offset.value.set(offset.x, offset.y);
      this.uniforms.repeat.value.set(repeat.x, repeat.y);
    };

    this.material.setGlobalPosition = ([x, y, z]) => {
      this.uniforms.globalPosition.value.set(x, y, z);
    };

    this.material.setAnchorPoint = ([x, y, z]) => {
      this.uniforms.anchorPoint.value.set(x, y, z);
    };

    this.material.setUVW = ([u, v, w]) => {
      this.uniforms.anchorPoint.value.set(u, v, w);
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
  uniform float <%= name %>_brightness;
  uniform float <%= name %>_contrast;
  uniform vec3 <%= name %>_color;
  uniform float <%= name %>_weight;
<% }) %>
<% if (hasSegmentation) { %>
  uniform sampler2D <%= segmentationName %>_texture;
<% } %>
uniform vec2 offset, repeat;
uniform float alpha;
uniform vec3 globalPosition;
uniform vec3 anchorPoint;
uniform float zoomStep;
uniform vec3 uvw;

varying vec2 vPos;
varying vec2 vUv;
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

vec3 getRGBAtIndex(sampler2D texture, float textureWidth, float idx, float multiplier) {
  float finalPosX = mod(idx, textureWidth);
  float finalPosY = div(idx, textureWidth);

  return texture2D(
      texture,
      vec2(
        (floor(finalPosX) + 0.5 * multiplier) / textureWidth,
        (floor(finalPosY) + 0.5 * multiplier) / textureWidth
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

void main() {
  float golden_ratio = 0.618033988749895;
  float color_value  = 0.0;
  vec2 texture_pos = vUv * repeat + offset;
  // Mirror y since (0, 0) refers to the lower-left corner in WebGL instead of the upper-left corner
  texture_pos = vec2(texture_pos.x, 1.0 - texture_pos.y);
  // <% if (hasSegmentation) { %>
  //   vec4 volume_color = texture2D(<%= segmentationName %>_texture, texture_pos);
  //   float id = (volume_color.r * 255.0);
  // <% } else { %>
  //   float id = 0.0;
  // <% } %>
  // /* Get Color Value(s) */
  // <% if (isRgb) { %>
  //   vec3 data_color = texture2D( <%= layers[0] %>_texture, texture_pos).xyz;
  //   data_color = (data_color + <%= layers[0] %>_brightness - 0.5) * <%= layers[0] %>_contrast + 0.5;
  // <% } else { %>
  //   vec3 data_color = vec3(0.0, 0.0, 0.0);
  //   <% _.each(layers, function(name){ %>
  //     /* Get grayscale value */
  //     color_value = texture2D( <%= name %>_texture, texture_pos).r;
  //     /* Brightness / Contrast Transformation */
  //     color_value = (color_value + <%= name %>_brightness - 0.5) * <%= name %>_contrast + 0.5;

  //     /* Multiply with color and weight */
  //     data_color += color_value * <%= name %>_weight * <%= name %>_color;
  //   <% }) %> ;
  //   data_color = clamp(data_color, 0.0, 1.0);
  // <% } %>
  // /* Color map (<= to fight rounding mistakes) */
  // if ( id > 0.1 ) {
  //   vec4 HSV = vec4( mod( id * golden_ratio, 1.0), 1.0, 1.0, 1.0 );
  //   gl_FragColor = vec4(mix( data_color, hsv_to_rgb(HSV), alpha ), 1.0);
  // } else {
  //   gl_FragColor = vec4(data_color, 1.0);
  // }

  float bucketPerDim = 16.0;
  float bucketWidth = 32.0;
  float bucketLength = bucketWidth * bucketWidth * bucketWidth;
  float r_texture_width = 512.0;
  float d_texture_width = 8192.0;
  float l_texture_width = 64.0; // next power of two ceil(floor(bucketsPerDim**3))
  float bytesPerLookUpEntry = 1.0; // todo: pass as uniform or from template

  // texture_pos = vec2(mod(texture_pos.x, 1.0/9.0), mod(texture_pos.y, 1.0/9.0));
  // old
  // float xCoord = mod(floor(texture_pos.x * r_texture_width - 0.0000), r_texture_width); // [0...512]
  // float yCoord = mod(floor(texture_pos.y * r_texture_width - 0.0000), r_texture_width);

  // previous
  // float xCoord = mod(floor(texture_pos.x * ((r_texture_width - 1.0)/r_texture_width)), r_texture_width);
  // float yCoord = mod(floor(texture_pos.y * ((r_texture_width - 1.0)/r_texture_width)), r_texture_width);

  // float anisotropyFactor = 44.599998474121094 / 22.0;
   // <%= this.planeID === OrthoViews.PLANE_YZ ? "texture_pos.x = texture_pos.x / 2.0;" : "" %>
  vec3 coords = transDim(vec3(
    mod(floor(texture_pos.x * (r_texture_width * 0.99999)), r_texture_width),
    mod(floor(texture_pos.y * (r_texture_width * 0.99999)), r_texture_width),
    floor((globalPosition[<%= uvw[2] %>] - anchorPoint[<%= uvw[2] %>] * pow(2.0, 5.0 + zoomStep)) / pow(2.0, zoomStep))
  ));

  float xCoord = coords.x;
  float yCoord = coords.y;
  float zCoord = coords.z;

  vec3 bucketPosition = vec3(
    div(xCoord, bucketWidth),
    div(yCoord, bucketWidth),
    div(zCoord, bucketWidth)
  );
  float bucketIdx = linearizeVec3ToIndex(bucketPosition, bucketPerDim); // save
  float bucketIdxInTexture = bucketIdx * bytesPerLookUpEntry; // save

  float bucketAddress = getRGBAtIndex(
    <%= layers[0] %>_lookup_texture,
    l_texture_width,
    bucketIdxInTexture,
    0.1
  ).x;


  vec3 offsetInBucket = vec3(
    mod(xCoord, bucketWidth),
    mod(yCoord, bucketWidth),
    mod(zCoord, bucketWidth)
  );

  float pixelIdxInBucket = linearizeVec3ToIndex(offsetInBucket, bucketWidth);
  float pixelIdxInDataTexture = pixelIdxInBucket + bucketLength * bucketAddress;

  float x = linearizeVec3ToIndexWithMod(offsetInBucket, bucketWidth, d_texture_width);
  float y = div(pixelIdxInDataTexture, d_texture_width);

  vec3 bucketColor = getRGBAtXYIndex(
    <%= layers[0] %>_texture,
    d_texture_width,
    x,
    y
  );

  gl_FragColor = vec4(bucketColor, 1.0);
  // gl_FragColor = vec4(mix(bucketColor, vec3(bucketAddress / 144., 0.0, 0.0), <%= layers[0] %>_brightness), 1.0);
  // mix( data_color, hsv_to_rgb(HSV), alpha )
  // gl_FragColor = vec4(bucketPosition / vec3(12.0, 12.0, 12.0), 1.0);

  if (bucketAddress < 0.) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
  // gl_FragColor = vec4(bucketAddress / pow(12.0, 2.0), 0.0, 0.0, 1.0);
  // gl_FragColor = vec4(pixelIdxInBucket / pow(32.0, 2.0), 0.0, 0.0, 1.0);
  // gl_FragColor = vec4(texture_pos.x, texture_pos.y, 0.0, 1.0);
  // gl_FragColor = vec4(0.0, bucketIdx / pow(l_texture_width, 2.0), 0.0, 1.0);
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
      uvw: Dimensions.getIndices(this.planeID)
    });
  }
}

export default PlaneMaterialFactory;
