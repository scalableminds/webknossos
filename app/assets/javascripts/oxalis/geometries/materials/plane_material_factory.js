import _ from "lodash";
import app from "app";
import THREE from "three";
import AbstractPlaneMaterialFactory from "./abstract_plane_material_factory";

class PlaneMaterialFactory extends AbstractPlaneMaterialFactory {


  setupAttributesAndUniforms() {

    super.setupAttributesAndUniforms();

    return this.uniforms = _.extend(this.uniforms, {
      offset : {
        type : "v2",
        value : new THREE.Vector2(0, 0)
      },
      repeat : {
        type : "v2",
        value : new THREE.Vector2(1, 1)
      },
      alpha : {
        type : "f",
        value : 0
      }
    }
    );
  }


  convertColor(color) {

    return _.map(color, e => e / 255);
  }


  createTextures() {

    // create textures
    let shaderName;
    this.textures = {};
    for (let name in this.model.binary) {
      const binary = this.model.binary[name];
      const bytes = binary.targetBitDepth >> 3;
      shaderName = this.sanitizeName(name);
      this.textures[shaderName] = this.createDataTexture(this.tWidth, bytes);
      this.textures[shaderName].binaryCategory = binary.category;
      this.textures[shaderName].binaryName = binary.name;
    }

    return (() => {
      const result = [];
      for (shaderName in this.textures) {
        const texture = this.textures[shaderName];
        let item;
        this.uniforms[shaderName + "_texture"] = {
          type : "t",
          value : texture
        };
        if (texture.binaryCategory !== "segmentation") {
          const color = this.convertColor(this.model.datasetConfiguration.get(`layers.${texture.binaryName}.color`));
          this.uniforms[shaderName + "_weight"] = {
            type : "f",
            value : 1
          };
          item = this.uniforms[shaderName + "_color"] = {
            type : "v3",
            value : new THREE.Vector3(...color)
          };
        }
        result.push(item);
      }
      return result;
    })();
  }


  makeMaterial(options) {

    super.makeMaterial(options);

    this.material.setColorInterpolation = interpolation => {
      return (() => {
        const result = [];
        for (let name in this.textures) {
          const texture = this.textures[name];
          let item;
          if (texture.binaryCategory === "color") {
            texture.magFilter = interpolation;
            item = texture.needsUpdate = true;
          }
          result.push(item);
        }
        return result;
      })();
    };

    this.material.setScaleParams = ({offset, repeat}) => {
      this.uniforms.offset.value.set(offset.x, offset.y);
      return this.uniforms.repeat.value.set(repeat.x, repeat.y);
    };

    this.material.setSegmentationAlpha = alpha => {
      return this.uniforms.alpha.value = alpha / 100;
    };

    return this.material.side = THREE.DoubleSide;
  }


  setupChangeListeners() {

    super.setupChangeListeners();

    return this.listenTo(this.model.datasetConfiguration, "change" , function(model) {
      const object = model.changed.layers || {};
      for (let binaryName in object) {
        const changes = object[binaryName];
        const name = this.sanitizeName(binaryName);
        if (changes.color != null) {
          const color = this.convertColor(changes.color);
          this.uniforms[name + "_color"].value = new THREE.Vector3(...color);
        }
      }

      return app.vent.trigger("rerender");
    });
  }


  getFragmentShader() {

    const colorLayerNames = _.map(this.model.getColorBinaries(), b => this.sanitizeName(b.name));
    const segmentationBinary = this.model.getSegmentationBinary();

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
  <% if (hasSegmentation) { %>
    vec4 volume_color = texture2D(<%= segmentationName %>_texture, vUv * repeat + offset);
    float id = (volume_color.r * 255.0);
  <% } else { %>
    float id = 0.0;
  <% } %>
  /* Get Color Value(s) */
  <% if (isRgb) { %>
    vec3 data_color = texture2D( <%= layers[0] %>_texture, vUv * repeat + offset).xyz;
    data_color = (data_color + <%= layers[0] %>_brightness - 0.5) * <%= layers[0] %>_contrast + 0.5;
  <% } else { %>
    vec3 data_color = vec3(0.0, 0.0, 0.0);
    <% _.each(layers, function(name){ %>
      /* Get grayscale value */
      color_value = texture2D( <%= name %>_texture, vUv * repeat + offset).r;
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
`
    )({
        layers : colorLayerNames,
        hasSegmentation : (segmentationBinary != null),
        segmentationName : this.sanitizeName( __guard__(segmentationBinary, x => x.name) ),
        isRgb : __guard__(this.model.binary["color"], x1 => x1.targetBitDepth) === 24
      }
    );
  }
}

export default PlaneMaterialFactory;

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
