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
      const { particleSize, scale } = Store.getState().userConfiguration;
      this.uniforms.zoomFactor.value = getPlaneScalingFactor(Store.getState().flycam);
      this.uniforms.particleSize.value = particleSize;
      this.uniforms.scale.value = scale;
      app.vent.trigger("rerender");
    });
  }


  getVertexShader() {
    return `\
precision highp float;
precision highp int;

varying vec3 vColor;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform float zoomFactor;
uniform float baseVoxel;
uniform float particleSize;
uniform float scale;
uniform int   showRadius;
attribute float radius;
attribute float nodeScaleFactor;
attribute vec3 position;
attribute vec3 color;
attribute float type;
attribute float nodeId;
attribute float treeId;

void main()
{
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    vColor = vec3(1.0, 0.5, 0.5);
    gl_PointSize = 5.0;
    gl_Position = projectionMatrix * mvPosition;
}\
`;
  }

// void main()
// {
//     vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
//     vColor = vec3(1.0, 0.5, 0.5);
//     if (showRadius == 1)
//       gl_PointSize = max(
//           radius * 2.0 / zoomFactor / baseVoxel,
//           particleSize
//         ) * scale * nodeScaleFactor;
//     else
//       gl_PointSize = particleSize * nodeScaleFactor;
//     gl_Position = projectionMatrix * mvPosition;
// }\
// `;
//   }

  getFragmentShader() {
    return `\
precision highp float;

varying vec3 vColor;

void main()
{
    gl_FragColor = vec4( vColor, 1.0 );
}\
`;
  }
}

export default ParticleMaterialFactory;
