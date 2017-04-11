/**
 * particle_material_factory.js
 * @flow
 */

import * as THREE from "three";

class EdgeShader {

  material: THREE.RawShaderMaterial;
  uniforms: {
    [key: string]: {
      type: "f" | "i" | "t",
      value: any,
    }
  };

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

uniform sampler2D treeColors;

attribute vec3 position;
attribute float treeId;

void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec2 treeIdToTextureCoordinate = vec2(fract(treeId / 1024.0), treeId / (1024.0 * 1024.0));
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
