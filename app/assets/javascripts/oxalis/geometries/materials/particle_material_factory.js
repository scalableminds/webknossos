/**
 * particle_material_factory.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import Store from "oxalis/store";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import AbstractMaterialFactory from "oxalis/geometries/materials/abstract_material_factory";
import { getPlaneScalingFactor } from "oxalis/model/accessors/flycam_accessor";
import { NodeTypes } from "oxalis/geometries/skeleton_geometry_handler";

const DEFAULT_RADIUS = 1.0;

class ParticleMaterialFactory extends AbstractMaterialFactory {

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  setupUniforms() {
    super.setupUniforms();
    const state = Store.getState();

    this.uniforms = _.extend(this.uniforms, {
      zoomFactor: {
        type: "f",
        value: getPlaneScalingFactor(state.flycam),
      },
      baseVoxel: {
        type: "f",
        value: getBaseVoxel(state.dataset.scale),
      },
      particleSize: {
        type: "f",
        value: state.userConfiguration.particleSize,
      },
      scale: {
        type: "f",
        value: state.userConfiguration.scale,
      },
      showRadius: {
        type: "i",
        value: DEFAULT_RADIUS,
      },
      activeTreeId: {
        type: "f",
        value: NaN,
      },
      activeNodeId: {
        type: "f",
        value: NaN,
      },
    },
    );
  }


  makeMaterial() {
    super.makeMaterial({ vertexColors: true });

    this.material.setShowRadius = (showRadius) => {
      const radius = this.uniforms.showRadius.value = showRadius ? 1 : 0;
      return radius;
    };
  }


  setupChangeListeners() {
    super.setupChangeListeners();

    Store.subscribe(() => {
      const state = Store.getState();
      const { particleSize, scale } = state.userConfiguration;
      this.uniforms.zoomFactor.value = getPlaneScalingFactor(Store.getState().flycam);
      this.uniforms.particleSize.value = particleSize;
      this.uniforms.scale.value = scale;
      this.uniforms.activeTreeId.value = state.skeletonTracing.activeTreeId;
      this.uniforms.activeNodeId.value = state.skeletonTracing.activeNodeId;
      app.vent.trigger("rerender");
    });
  }


  getVertexShader() {
    return `\
precision highp float;
precision highp int;

varying vec3 color;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float zoomFactor;
uniform float baseVoxel;
uniform float particleSize;
uniform float scale;
uniform int showRadius;
uniform float activeNodeId;
uniform float activeTreeId;
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

void main()
{
    float nodeScaleFactor = 1.0;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    gl_PointSize = 5.0;
    color = vec3(1.0, 0.0, 1.0);

    // DELETED NODE
    if (type == ${NodeTypes.INVALID.toFixed(1)}) {
      gl_PointSize = 3.0;
    }

    if (activeNodeId == nodeId) {
      color = shiftColor(color, 0.25);
      gl_PointSize = 10.0;
    }

    if (type == ${NodeTypes.BRANCH_POINT.toFixed(1)}) {
      color = shiftColor(color, 0.5);
    }

    gl_Position = projectionMatrix * mvPosition;
}\
`;
  }

  getFragmentShader() {
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

export default ParticleMaterialFactory;
