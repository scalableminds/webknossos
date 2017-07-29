// @flow

import * as THREE from "three";
import { COLOR_TEXTURE_WIDTH } from "oxalis/geometries/materials/node_shader";
import type { UniformsType } from "oxalis/geometries/materials/abstract_plane_material_factory";

class EdgeShader {
  material: THREE.RawShaderMaterial;
  uniforms: UniformsType;

  constructor(treeColorTexture: THREE.DataTexture) {
    this.setupUniforms(treeColorTexture);

    this.material = new THREE.RawShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
    });
  }

  setupUniforms(treeColorTexture: THREE.DataTexture): void {
    this.uniforms = {
      activeTreeId: {
        type: "f",
        value: NaN,
      },
      treeColors: {
        type: "t",
        value: treeColorTexture,
      },
      is3DView: {
        type: "i",
        value: false,
      },
    };
  }

  getMaterial(): THREE.RawShaderMaterial {
    return this.material;
  }

  getVertexShader(): string {
    return `\
precision highp float;
precision highp int;

varying vec3 color;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float activeTreeId;
uniform int is3DView; // indicates whether we are currently rendering the 3D viewport

uniform sampler2D treeColors;

attribute vec3 position;
attribute float treeId;

void main() {
    vec2 treeIdToTextureCoordinate = vec2(fract(treeId / ${COLOR_TEXTURE_WIDTH.toFixed(
      1,
    )}), treeId / (${COLOR_TEXTURE_WIDTH.toFixed(1)} * ${COLOR_TEXTURE_WIDTH.toFixed(1)}));
    bool isVisible = texture2D(treeColors, treeIdToTextureCoordinate).a == 1.0 || is3DView == 1;

    if (!isVisible) {
      gl_Position = vec4(-1.0, -1.0, -1.0, -1.0);
      return;
    }

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    color = texture2D(treeColors, treeIdToTextureCoordinate).rgb;
}\
`;
  }

  getFragmentShader(): string {
    return `\
precision highp float;

varying vec3 color;

void main()
{
    gl_FragColor = vec4(color, 1.0);
}\
`;
  }
}
export default EdgeShader;
