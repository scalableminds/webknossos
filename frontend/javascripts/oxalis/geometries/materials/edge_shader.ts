import * as THREE from "three";
import { COLOR_TEXTURE_WIDTH_FIXED } from "oxalis/geometries/materials/node_shader";
import type { Uniforms } from "oxalis/geometries/materials/plane_material_factory";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import shaderEditor from "oxalis/model/helpers/shader_editor";

class EdgeShader {
  material: THREE.RawShaderMaterial;
  uniforms: Uniforms = {};

  constructor(treeColorTexture: THREE.DataTexture) {
    this.setupUniforms(treeColorTexture);
    this.material = new THREE.RawShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
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
      currentAdditionalCoords: {
        // todop
        value: [0],
      },
    };

    listenToStoreProperty(
      (storeState) => storeState.flycam.additionalCoords,
      (additionalCoords) => {
        this.uniforms.currentAdditionalCoords.value = additionalCoords;
      },
      true,
    );
  }

  getMaterial(): THREE.RawShaderMaterial {
    return this.material;
  }

  getVertexShader(): string {
    return `
precision highp float;
precision highp int;

out vec3 color;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float activeTreeId;
// todop: type of additional coord needs to be dynamic?
uniform float currentAdditionalCoords;
uniform sampler2D treeColors;

in vec3 position;
in float treeId;

// todop: type of additional coord needs to be dynamic?
in float additionalCoords;

void main() {
    if (additionalCoords != currentAdditionalCoords) {
      return;
    }

    vec2 treeIdToTextureCoordinate = vec2(fract(
      treeId / ${COLOR_TEXTURE_WIDTH_FIXED}),
      treeId / (${COLOR_TEXTURE_WIDTH_FIXED} * ${COLOR_TEXTURE_WIDTH_FIXED}
    ));
    bool isVisible = texture(treeColors, treeIdToTextureCoordinate).a == 1.0;

    if (!isVisible) {
      gl_Position = vec4(-1.0, -1.0, -1.0, -1.0);
      return;
    }

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    color = texture(treeColors, treeIdToTextureCoordinate).rgb;
}`;
  }

  getFragmentShader(): string {
    return `
precision highp float;

out vec4 fragColor;
in vec3 color;

void main()
{
    fragColor = vec4(color, 1.0);
}`;
  }
}

export default EdgeShader;
