import * as THREE from "three";
import { COLOR_TEXTURE_WIDTH_FIXED } from "oxalis/geometries/materials/node_shader";
import type { Uniforms } from "oxalis/geometries/materials/plane_material_factory";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import { Store } from "oxalis/singletons";
import _ from "lodash";

class EdgeShader {
  material: THREE.RawShaderMaterial;
  uniforms: Uniforms = {};

  constructor(treeColorTexture: THREE.DataTexture) {
    this.setupUniforms(treeColorTexture);
    this.material = new THREE.RawShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
      transparent: true,
      glslVersion: THREE.GLSL3,
    });
    shaderEditor.addMaterial("edge", this.material);
  }

  setupUniforms(treeColorTexture: THREE.DataTexture): void {
    this.uniforms = {
      activeTreeId: {
        value: NaN,
      },
      treeColors: {
        value: treeColorTexture,
      },
    };
    const { additionalCoordinates } = Store.getState().flycam;

    _.each(additionalCoordinates, (_val, idx) => {
      this.uniforms[`currentAdditionalCoord_${idx}`] = {
        value: 0,
      };
    });

    listenToStoreProperty(
      (storeState) => storeState.flycam.additionalCoordinates,
      (additionalCoordinates) => {
        _.each(additionalCoordinates, (coord, idx) => {
          this.uniforms[`currentAdditionalCoord_${idx}`].value = coord.value;
        });
      },
      true,
    );
  }

  getMaterial(): THREE.RawShaderMaterial {
    return this.material;
  }

  getVertexShader(): string {
    const { additionalCoordinates } = Store.getState().flycam;

    return _.template(`
precision highp float;
precision highp int;

out vec3 color;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float activeTreeId;
uniform sampler2D treeColors;

<% _.each(additionalCoordinates || [], (_coord, idx) => { %>
  uniform float currentAdditionalCoord_<%= idx %>;
<% }) %>

in vec3 position;
in float treeId;

<% _.each(additionalCoordinates || [], (_coord, idx) => { %>
  in float additionalCoord_<%= idx %>;
<% }) %>

out float alpha;

void main() {
    alpha = 1.0;
    <% _.each(additionalCoordinates || [], (_coord, idx) => { %>
      if (additionalCoord_<%= idx %> != currentAdditionalCoord_<%= idx %>) {
        alpha = 0.;
      }
    <% }) %>

    ivec2 treeIdToTextureCoordinate = ivec2(
      mod(treeId, ${COLOR_TEXTURE_WIDTH_FIXED}),
      mod(floor(treeId / ${COLOR_TEXTURE_WIDTH_FIXED}), ${COLOR_TEXTURE_WIDTH_FIXED})
    );
    vec4 rgba = texelFetch(treeColors, treeIdToTextureCoordinate, 0);
    bool isVisible = rgba.a == 1.0;

    if (!isVisible) {
      gl_Position = vec4(-1.0, -1.0, -1.0, -1.0);
      return;
    }

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    color = rgba.rgb;
}`)({ additionalCoordinates });
  }

  getFragmentShader(): string {
    return `
precision highp float;

out vec4 fragColor;
in vec3 color;
in float alpha;

void main()
{
    fragColor = vec4(color, alpha);
}`;
  }
}

export default EdgeShader;
