/**
 * particle_material_factory.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import Store from "oxalis/store";
import { getBaseVoxel } from "oxalis/model/scaleinfo";
import AbstractMaterialFactory from "oxalis/geometries/materials/abstract_material_factory";
import { getPlaneScalingFactor } from "oxalis/model/accessors/flycam2d_accessor";

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
        value: getPlaneScalingFactor(state.flycam3d),
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
      this.uniforms.zoomFactor.value = getPlaneScalingFactor(Store.getState().flycam3d);
      this.uniforms.particleSize.value = particleSize;
      this.uniforms.scale.value = scale;
      app.vent.trigger("rerender");
    });
  }


  getVertexShader() {
    return `\
uniform float zoomFactor;
uniform float baseVoxel;
uniform float particleSize;
uniform float scale;
uniform int   showRadius;
varying vec3 vColor;
attribute float sizeNm;
attribute float nodeScaleFactor;

void main()
{
    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
    vColor = color;
    if (showRadius == 1)
      gl_PointSize = max(
          sizeNm / zoomFactor / baseVoxel,
          particleSize
        ) * scale * nodeScaleFactor;
    else
      gl_PointSize = particleSize * nodeScaleFactor;
    gl_Position = projectionMatrix * mvPosition;
}\
`;
  }


  getFragmentShader() {
    return `\
varying vec3 vColor;

void main()
{
    gl_FragColor = vec4( vColor, 1.0 );
}\
`;
  }
}

export default ParticleMaterialFactory;
