/**
 * particle_material_factory.js
 * @flow
 */

import * as THREE from "three";
import Store from "oxalis/store";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import { getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";
import { OrthoViews } from "oxalis/constants";

export const NodeTypes = {
  INVALID: -1.0,
  NORMAL: 0.0,
  BRANCH_POINT: 1.0,
};

class NodeShader {

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
      shouldHideInactiveTrees: {
        type: "i",
        value: state.temporaryConfiguration.shouldHideInactiveTrees,
      },
      shouldHideAllSkeletons: {
        type: "i",
        value: state.temporaryConfiguration.shouldHideAllSkeletons,
      },
      is3DView: {
        type: "i",
        value: state.temporaryConfiguration.activeCamera === OrthoViews.TDViews,
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
uniform float overrideParticleSize;
uniform float viewportScale;
uniform float activeNodeScaleFactor;
uniform float activeNodeId;
uniform float activeTreeId;
uniform int overrideNodeRadius;
uniform int shouldHideInactiveTrees;
uniform int shouldHideAllSkeletons;
uniform int is3DView;

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

bool isVisible() {
  bool b_shouldHideInactiveTrees = shouldHideInactiveTrees == 1;
  bool b_shouldHideAllSkeletons = shouldHideAllSkeletons == 1;
  bool b_is3DView = is3DView == 1;

  return (b_is3DView); // || !b_shouldHideAllSkeletons) && (!b_shouldHideInactiveTrees || activeTreeId == treeId);
}

void main() {
    if (!isVisible()) {
      gl_Position = vec4(-1.0, -1.0, -1.0, -1.0);
      return;
    }

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec2 treeIdToTextureCoordinate = vec2(fract(treeId / 1024.0), treeId / (1024.0 * 1024.0));
    color = texture2D(treeColors, treeIdToTextureCoordinate).rgb;

    if (overrideNodeRadius == 1) {
      gl_PointSize = overrideParticleSize;
    } else {
      gl_PointSize = max(
        radius / planeZoomFactor / datasetScale,
        overrideParticleSize
      ) * viewportScale;
    }

    // DELETED NODE
    if (type == ${NodeTypes.INVALID.toFixed(1)}) {
      gl_Position = vec4(-1.0, -1.0, -1.0, 0.0);
    }

    if (activeNodeId == nodeId) {
      color = shiftColor(color, 0.25);
      gl_PointSize *= activeNodeScaleFactor;
    }

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
