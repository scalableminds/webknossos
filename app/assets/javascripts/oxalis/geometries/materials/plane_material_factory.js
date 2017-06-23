/**
 * plane_material_factory.js
 * @flow
 */

import _ from "lodash";
import * as THREE from "three";
import app from "app";
import Utils from "libs/utils";
import Store from "oxalis/store";
import Model from "oxalis/model";
import AbstractPlaneMaterialFactory from "oxalis/geometries/materials/abstract_plane_material_factory";
import type { Vector3 } from "oxalis/constants";
import type { ShaderMaterialOptionsType } from "oxalis/geometries/materials/abstract_plane_material_factory";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";

const DEFAULT_COLOR = new THREE.Vector3([255, 255, 255]);

class PlaneMaterialFactory extends AbstractPlaneMaterialFactory {

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
    },
    );
  }


  convertColor(color: Vector3): Vector3 {
    return [
      color[0] / 255,
      color[1] / 255,
      color[2] / 255,
    ];
  }


  createTextures(): void {
    // create textures
    let shaderName;
    this.textures = {};
    for (const name of Object.keys(Model.binary)) {
      const binary = Model.binary[name];
      const bytes = binary.targetBitDepth >> 3;
      shaderName = this.sanitizeName(name);
      this.textures[shaderName] = this.createDataTexture(this.tWidth, bytes);
      this.textures[shaderName].binaryCategory = binary.category;
      this.textures[shaderName].binaryName = binary.name;
    }

    for (shaderName of Object.keys(this.textures)) {
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


  makeMaterial(options?: ShaderMaterialOptionsType):void {
    super.makeMaterial(options);

    this.material.setColorInterpolation = (interpolation) => {
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

    this.material.setSegmentationAlpha = (alpha) => { this.uniforms.alpha.value = alpha / 100; };

    this.material.side = THREE.DoubleSide;
  }


  setupChangeListeners(): void {
    super.setupChangeListeners();

    listenToStoreProperty(
      (state) => state.datasetConfiguration.layers,
      (layerSettings) => {
        _.forEach(layerSettings, (settings, layerName) => {
          const name = this.sanitizeName(layerName);
          if (settings.color != null) {
            const color = this.convertColor(settings.color);
            this.uniforms[`${name}_color`].value = new THREE.Vector3(...color);
          }
        });

        app.vent.trigger("rerender");
      },
      true
    );
  }


  getFragmentShader(): string {
    const colorLayerNames = _.map(Model.getColorBinaries(), b => this.sanitizeName(b.name));
    const segmentationBinary = Model.getSegmentationBinary();

    return _.template(
      `\
<% _.each(layers, function(name) { %>
  uniform sampler2D <%= name %>_texture;
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
void main() {
  float golden_ratio = 0.618033988749895;
  float color_value  = 0.0;
  vec2 texture_pos = vUv * repeat + offset;
  // Need to mirror y for some reason.
  texture_pos = vec2(texture_pos.x, 1.0 - texture_pos.y);
  <% if (hasSegmentation) { %>
    vec4 volume_color = texture2D(<%= segmentationName %>_texture, texture_pos);
    float id = (volume_color.r * 255.0);
  <% } else { %>
    float id = 0.0;
  <% } %>
  /* Get Color Value(s) */
  <% if (isRgb) { %>
    vec3 data_color = texture2D( <%= layers[0] %>_texture, texture_pos).xyz;
    data_color = (data_color + <%= layers[0] %>_brightness - 0.5) * <%= layers[0] %>_contrast + 0.5;
  <% } else { %>
    vec3 data_color = vec3(0.0, 0.0, 0.0);
    <% _.each(layers, function(name){ %>
      /* Get grayscale value */
      color_value = texture2D( <%= name %>_texture, texture_pos).r;
      /* Brightness / Contrast Transformation */
      color_value = (color_value + <%= name %>_brightness - 0.5) * <%= name %>_contrast + 0.5;

      /* Multiply with color and weight */
      data_color += color_value * <%= name %>_weight * <%= name %>_color;
    <% }) %> ;
    data_color = clamp(data_color, 0.0, 1.0);
  <% } %>
  /* Color map (<= to fight rounding mistakes) */
  if ( id > 0.1 ) {
    vec4 HSV = vec4( mod( id * golden_ratio, 1.0), 1.0, 1.0, 1.0 );
    gl_FragColor = vec4(mix( data_color, hsv_to_rgb(HSV), alpha ), 1.0);
  } else {
    gl_FragColor = vec4(data_color, 1.0);
  }
}\
`,
    )({
      layers: colorLayerNames,
      hasSegmentation: (segmentationBinary != null),
      segmentationName: this.sanitizeName(segmentationBinary ? segmentationBinary.name : ""),
      isRgb: Utils.__guard__(Model.binary.color, x1 => x1.targetBitDepth) === 24,
    },
    );
  }
}

export default PlaneMaterialFactory;
