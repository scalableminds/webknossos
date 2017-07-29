// @flow

import * as THREE from "three";
import Store from "oxalis/store";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import { getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";
import type { UniformsType } from "oxalis/geometries/materials/abstract_plane_material_factory";

export const NodeTypes = {
  INVALID: 0.0,
  NORMAL: 1.0,
  BRANCH_POINT: 2.0,
};

export const COLOR_TEXTURE_WIDTH = 1024.0;

class NodeShader {

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
    const state = Store.getState();

    this.uniforms = {
      planeZoomFactor: {
        type: "f",
        value: getPlaneScalingFactor(state.flycam),
      },
      datasetScale: {
        type: "f",
        value: getBaseVoxel(state.dataset.scale),
      },
      overrideParticleSize: {
        type: "f",
        value: state.userConfiguration.particleSize,
      },
      viewportScale: {
        type: "f",
        value: state.userConfiguration.scale,
      },
      overrideNodeRadius: {
        type: "i",
        value: true,
      },
      activeTreeId: {
        type: "f",
        value: NaN,
      },
      activeNodeId: {
        type: "f",
        value: NaN,
      },
      activeNodeScaleFactor: {
        type: "f",
        value: 1.0,
      },
      treeColors: {
        type: "t",
        value: treeColorTexture,
      },
      is3DView: {
        type: "i",
        value: 0,
      },
      isPicking: {
        type: "i",
        value: 0,
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
uniform float planeZoomFactor;
uniform float datasetScale;
uniform float viewportScale;
uniform float activeNodeId;
uniform float activeTreeId;
uniform float activeNodeScaleFactor; // used for the "new node" animation
uniform float overrideParticleSize; // node radius for equally size nodes
uniform int overrideNodeRadius; // bool activates equaly node radius for all nodes
uniform int is3DView; // bool indicates whether we are currently rendering the 3D viewport
uniform int isPicking; // bool indicates whether we are currently rendering for node picking

uniform sampler2D treeColors;

attribute float radius;
attribute vec3 position;
attribute float type;
attribute float nodeId;
attribute float treeId;

// https://www.shadertoy.com/view/XljGzV
vec3 rgb2hsv(vec3 color) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(color.bg, K.wz), vec4(color.gb, K.xy), step(color.b, color.g));
    vec4 q = mix(vec4(p.xyw, color.r), vec4(color.r, p.yzx), step(p.x, color.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// https://www.shadertoy.com/view/XljGzV
vec3 hsv2rgb(vec3 color) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(color.xxx + K.xyz) * 6.0 - K.www);
    return color.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), color.y);
}

vec3 shiftColor(vec3 color, float shiftValue) {
    vec3 hsvColor = rgb2hsv(color);
    hsvColor.x = fract(hsvColor.x + shiftValue);
    return hsv2rgb(hsvColor);
}

void main() {
    vec2 treeIdToTextureCoordinate = vec2(fract(treeId / ${COLOR_TEXTURE_WIDTH.toFixed(1)}), treeId / (${COLOR_TEXTURE_WIDTH.toFixed(1)} * ${COLOR_TEXTURE_WIDTH.toFixed(1)}));
    color = texture2D(treeColors, treeIdToTextureCoordinate).rgb;
    bool isVisible = texture2D(treeColors, treeIdToTextureCoordinate).a == 1.0 || is3DView == 1;

    // VISIBILITY CAN BE TOGGLED THROUGH KEYBOARD SHORTCUTS
    // DELETED OR INVISIBLE NODE
    if (type == ${NodeTypes.INVALID.toFixed(1)} || !isVisible) {
      gl_Position = vec4(-1.0, -1.0, -1.0, -1.0);
      return;
    }

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

    // NODE RADIUS
    if (overrideNodeRadius == 1 || is3DView == 1) {
      gl_PointSize = overrideParticleSize;
    } else {
      gl_PointSize = max(
        radius / planeZoomFactor / datasetScale,
        overrideParticleSize
      ) * viewportScale;
    }

    // NODE COLOR FOR PICKING
    if (isPicking == 1) {
      // the nodeId is encoded in the RGB channels as a 3 digit base-255 number in a number of steps:
      // - nodeId is divided by the first three powers of 255.
      // - each quotient is rounded down to the nearest integer (since the fractional part of each quotient is covered by a less significant digit)
      // - each digit is divided by 255 again, since color values in OpenGL must be in the range [0, 1]
      // - finally, the non-fractional part of each digit is removed (since it is covered by a more significant digit)
      color = fract(floor(nodeId / vec3(255.0 * 255.0, 255.0, 1.0)) / 255.0);
      gl_PointSize *= 1.5;
      return;
    }

    // NODE COLOR FOR ACTIVE NODE
    if (activeNodeId == nodeId) {
      color = shiftColor(color, 0.25);
      gl_PointSize *= activeNodeScaleFactor;
    }

    // NODE COLOR FOR BRANCH_POINT
    if (type == ${NodeTypes.BRANCH_POINT.toFixed(1)}) {
      color = shiftColor(color, 0.5);
    }
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
export default NodeShader;
