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
  createDataTexture,
  sanitizeName,
} from "oxalis/geometries/materials/abstract_plane_material_factory";
import type {
  ShaderMaterialOptionsType,
  TextureMapType,
} from "oxalis/geometries/materials/abstract_plane_material_factory";
import type { OrthoViewType, Vector3 } from "oxalis/constants";
import type { DatasetLayerConfigurationType } from "oxalis/store";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import constants, { OrthoViews } from "oxalis/constants";
import Dimensions from "oxalis/model/dimensions";
import { floatsPerLookUpEntry } from "oxalis/model/binary/texture_bucket_manager";

const DEFAULT_COLOR = new THREE.Vector3([255, 255, 255]);

function formatNumberAsGLSLFloat(aNumber: number): string {
  if (aNumber - Math.floor(aNumber) > 0) {
    return aNumber.toString();
  } else {
    return aNumber.toFixed(1);
  }
}

class PlaneMaterialFactory extends AbstractPlaneMaterialFactory {
  planeID: OrthoViewType;

  constructor(tWidth: number, textures: TextureMapType, planeID: OrthoViewType) {
    super(tWidth, textures);
    this.planeID = planeID;
  }

  setupUniforms(): void {
    super.setupUniforms();

    this.uniforms = _.extend(this.uniforms, {
      alpha: {
        type: "f",
        value: 0,
      },
      globalPosition: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
      datasetScale: {
        type: "v3",
        value: Store.getState().dataset.scale,
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
      zoomValue: {
        type: "f",
        value: 1,
      },
      uvw: {
        type: "v3",
        value: new THREE.Vector3(0, 0, 0),
      },
      useBilinearFiltering: {
        type: "b",
        value: true,
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

    for (const shaderName of Object.keys(this.textures)) {
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

    this.attachResolutionsTexture();
  }

  attachResolutionsTexture(): void {
    const resolutions = _.first(Model.getColorBinaries()).layer.resolutions;
    // $FlowFixMe
    const data = new Float32Array(_.flatten(resolutions));

    const dimensionCount = 3;
    const width = Math.ceil(Math.sqrt(data.length / dimensionCount));

    const texture = createDataTexture(
      width,
      dimensionCount,
      true,
      THREE.NearestFilter,
      THREE.NearestFilter,
    );

    texture.image.data.set(data);
    texture.needsUpdate = true;

    this.uniforms.resolutionsTexture = {
      type: "t",
      value: texture,
    };

    this.uniforms.resolutionsTextureWidth = {
      type: "f",
      value: width,
    };
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

    this.material.side = THREE.DoubleSide;

    listenToStoreProperty(
      storeState => getRequestLogZoomStep(storeState),
      zoomStep => {
        this.uniforms.zoomStep.value = zoomStep;
      },
    );

    listenToStoreProperty(
      storeState => storeState.flycam.zoomStep,
      zoomStep => {
        this.uniforms.zoomValue.value = zoomStep;
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
uniform float alpha;
uniform vec3 globalPosition;
uniform vec3 anchorPoint;
uniform vec3 fallbackAnchorPoint;
uniform float zoomStep;
uniform float zoomValue;
uniform vec3 uvw;
uniform bool useBilinearFiltering;
uniform vec3 datasetScale;
uniform sampler2D resolutionsTexture;
uniform float resolutionsTextureWidth;

varying vec4 worldCoord;

const float bucketPerDim = <%= bucketPerDim %>;
const float bucketWidth = <%= bucketWidth %>;
const float bucketSize = <%= bucketSize %>;
const float d_texture_width = <%= d_texture_width %>;
const float l_texture_width = <%= l_texture_width %>;
const float floatsPerLookUpEntry = <%= floatsPerLookUpEntry %>;

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

vec3 div(vec3 a, float b) {
  return floor(a / b);
}

float round(float a) {
  return floor(a + 0.5);
}

vec3 round(vec3 a) {
  return floor(a + 0.5);
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

bool isnan(float val) {
  // https://stackoverflow.com/questions/9446888/best-way-to-detect-nans-in-opengl-shaders
  return !(val < 0.0 || 0.0 < val || val == 0.0);
  // important: some nVidias failed to cope with version below.
  // Probably wrong optimization.
  /*return ( val <= 0.0 || 0.0 <= val ) ? false : true;*/
}

vec4 getColorFor(sampler2D lookUpTexture, sampler2D dataTexture, vec3 bucketPosition, vec3 offsetInBucket) {
  float bucketIdx = linearizeVec3ToIndex(bucketPosition, bucketPerDim);
  float bucketIdxInTexture = bucketIdx * floatsPerLookUpEntry;
  float pixelIdxInBucket = linearizeVec3ToIndex(offsetInBucket, bucketWidth);

  float bucketAddress = getRgbaAtIndex(
    lookUpTexture,
    l_texture_width,
    bucketIdxInTexture
  ).x;

  if (bucketAddress == -2.0) {
    // The bucket is out of bounds. Render black
    return vec4(0.0, 0.0, 0.0, 0.0);
  }

  if (bucketAddress < 0. || isnan(bucketAddress)) {
    // Not-yet-existing data is encoded with a = -1.0
    return vec4(0.0, 0.0, 0.0, -1.0);
  }

  float x =
    linearizeVec3ToIndexWithMod(offsetInBucket, bucketWidth, d_texture_width);
  float y =
    div(pixelIdxInBucket, d_texture_width) +
    div(bucketSize * bucketAddress, d_texture_width);

  vec4 bucketColor = getRgbaAtXYIndex(
    dataTexture,
    d_texture_width,
    x,
    y
  );

  return bucketColor;
}

vec4 getColorWithFallbackFor(
  sampler2D lookUpTexture,
  sampler2D dataTexture,
  vec3 bucketPosition,
  vec3 offsetInBucket,
  sampler2D flookUpTexture,
  sampler2D fdataTexture,
  vec3 fbucketPosition,
  vec3 foffsetInBucket,
  bool hasFallback
) {
  vec4 c = getColorFor(lookUpTexture, dataTexture, bucketPosition, offsetInBucket);

  if (c.a < 0.0 && hasFallback) {
    c = getColorFor(flookUpTexture, fdataTexture, fbucketPosition, foffsetInBucket);
    if (c.a < 0.0) {
      // Render gray for not-yet-existing data
      c = vec4(100.0, 100.0, 100.0, 255.0) / 255.0;
    }
  }
  return c;
}

vec3 getCoords(float usedZoomStep) {
  float zoomStepDiff = usedZoomStep - zoomStep;
  bool useFallback = zoomStepDiff > 0.0;
  vec3 usedAnchorPoint = useFallback ? fallbackAnchorPoint : anchorPoint;
  vec3 usedAnchorPointUVW = transDim(usedAnchorPoint);

  vec3 resolution = getRgbaAtIndex(resolutionsTexture, resolutionsTextureWidth, usedZoomStep).xyz;
  float zoomValue = pow(2.0, usedZoomStep);

  vec3 datasetScaleUVW = transDim(datasetScale);

  vec3 worldCoordUVW = vec3(
    // For u and w we need to divide by datasetScale because the threejs scene is scaled
    worldCoord[<%= uvw[0] %>] / datasetScaleUVW.x,
    worldCoord[<%= uvw[1] %>] / datasetScaleUVW.y,

    // globalPosition, however, gives us the coordinates we need
    // Theoretically, worldCoord[<%= uvw[2] %>] could be used here. However, the plane is offset
    // in 3D space to allow skeletons to be rendered before the plane. Since w (e.g., z for xy plane) is
    // the same for all texels computed in this shader, we simply use globalPosition[w] instead
    globalPosition[<%= uvw[2] %>]
  );

  vec3 resolutionUVW = transDim(resolution);
  vec3 anchorPointAsGlobalPositionUVW =
    usedAnchorPointUVW * resolutionUVW * bucketWidth;
  vec3 relativeCoords = (worldCoordUVW - anchorPointAsGlobalPositionUVW) / resolutionUVW;

  vec3 coords = transDim(relativeCoords);

  return coords;
}

vec4 getColorForCoords(sampler2D lookUpTexture, sampler2D dataTexture, vec3 coords) {
  coords = floor(coords);
  vec3 bucketPosition = div(coords, bucketWidth);
  vec3 offsetInBucket = mod(coords, bucketWidth);

  return getColorFor(
    lookUpTexture,
    dataTexture,
    bucketPosition,
    offsetInBucket
  );
}

vec4 getBilinearColorFor(sampler2D lookUpTexture, sampler2D dataTexture, vec3 coords) {
  coords = coords + vec3(-0.5, -0.5, 0.0);
  vec2 bifilteringParams = transDim((coords - floor(coords))).xy;
  coords = floor(coords);

  vec4 a = getColorForCoords(lookUpTexture, dataTexture, coords);
  vec4 b = getColorForCoords(lookUpTexture, dataTexture, coords + transDim(vec3(1, 0, 0)));
  vec4 c = getColorForCoords(lookUpTexture, dataTexture, coords + transDim(vec3(0, 1, 0)));
  vec4 d = getColorForCoords(lookUpTexture, dataTexture, coords + transDim(vec3(1, 1, 0)));
  if (a.a < 0.0 || b.a < 0.0 || c.a < 0.0 || d.a < 0.0) {
    // We need to check all four colors for a negative parts, because there will be black
    // lines at the borders otherwise (black gets mixed with data)
    return vec4(0.0, 0.0, 0.0, -1.0);
  }

  vec4 ab = mix(a, b, bifilteringParams.x);
  vec4 cd = mix(c, d, bifilteringParams.x);

  return mix(ab, cd, bifilteringParams.y);
}

vec3 getBilinearColorOrFallback(
  sampler2D lookUpTexture,
  sampler2D dataTexture,
  vec3 coords,
  sampler2D flookUpTexture,
  sampler2D fdataTexture,
  vec3 fBucketPos,
  vec3 fOffsetInBucket,
  bool hasFallback
) {
  vec4 color;
  if (useBilinearFiltering) {
    color = getBilinearColorFor(lookUpTexture, dataTexture, coords);
  } else {
    color = getColorForCoords(lookUpTexture, dataTexture, coords);
  }

  if (color.a < 0.0 && hasFallback) {
    color = getColorFor(flookUpTexture, fdataTexture, fBucketPos, fOffsetInBucket).rgba;
    if (color.a < 0.0) {
      // Render gray for not-yet-existing data
      color = vec4(100.0, 100.0, 100.0, 255.0) / 255.0;
    }
  }

  return color.xyz;
}

void main() {
  float golden_ratio = 0.618033988749895;
  float color_value  = 0.0;

  vec3 coords = getCoords(zoomStep);

  vec3 bucketPosition = div(floor(coords), bucketWidth);
  vec3 offsetInBucket = mod(floor(coords), bucketWidth);

  float fallbackZoomStep = min(<%= layers[0]%>_maxZoomStep, zoomStep + 1.0);
  bool hasFallback = fallbackZoomStep > zoomStep;
  vec3 fallbackCoords = floor(getCoords(fallbackZoomStep));
  vec3 fbucketPosition = div(fallbackCoords, bucketWidth);
  vec3 foffsetInBucket = mod(fallbackCoords, bucketWidth);

  <% if (hasSegmentation) { %>
    // Don't use bilinear filtering for volume data
    vec4 volume_color =
      getColorWithFallbackFor(
        <%= segmentationName %>_lookup_texture,
        <%= segmentationName %>_texture,
        bucketPosition,
        offsetInBucket,
        <%= segmentationName %>_lookup_fallback_texture,
        <%= segmentationName %>_fallback_texture,
        fbucketPosition,
        foffsetInBucket,
        hasFallback
      );

    float id = (volume_color.r + volume_color.g + volume_color.b + volume_color.a) * 255.0;
  <% } else { %>
    float id = 0.0;
  <% } %>

  // Get Color Value(s)
  <% if (isRgb) { %>
    vec3 data_color =
      getBilinearColorOrFallback(
        <%= layers[0] %>_lookup_texture,
        <%= layers[0] %>_texture,
        coords,
        <%= layers[0] %>_lookup_fallback_texture,
        <%= layers[0] %>_fallback_texture,
        fbucketPosition,
        foffsetInBucket,
        hasFallback
      );

    data_color = (data_color + <%= layers[0] %>_brightness - 0.5) * <%= layers[0] %>_contrast + 0.5;
  <% } else { %>
    vec3 data_color = vec3(0.0, 0.0, 0.0);
    <% _.each(layers, function(name){ %>
      // Get grayscale value for <%= name %>
      color_value =
        getBilinearColorOrFallback(
          <%= name %>_lookup_texture,
          <%= name %>_texture,
          coords,
          <%= name %>_lookup_fallback_texture,
          <%= name %>_fallback_texture,
          fbucketPosition,
          foffsetInBucket,
          hasFallback
        ).x;

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
      bucketPerDim: formatNumberAsGLSLFloat(constants.RENDERED_BUCKETS_PER_DIMENSION),
      d_texture_width: formatNumberAsGLSLFloat(constants.DATA_TEXTURE_WIDTH),
      l_texture_width: formatNumberAsGLSLFloat(constants.LOOK_UP_TEXTURE_WIDTH),
      bucketWidth: formatNumberAsGLSLFloat(constants.BUCKET_WIDTH),
      bucketSize: formatNumberAsGLSLFloat(constants.BUCKET_SIZE),
      floatsPerLookUpEntry: formatNumberAsGLSLFloat(floatsPerLookUpEntry),
    });
  }
}

export default PlaneMaterialFactory;
