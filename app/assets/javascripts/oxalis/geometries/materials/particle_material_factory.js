/**
 * particle_material_factory.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import Store from "oxalis/store";
import scaleInfo from "oxalis/model/scaleinfo";
import AbstractMaterialFactory from "oxalis/geometries/materials/abstract_material_factory";


const DEFAULT_RADIUS = 1.0;

class ParticleMaterialFactory extends AbstractMaterialFactory {

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  setupUniforms() {
    super.setupUniforms();

    this.uniforms = _.extend(this.uniforms, {
      zoomFactor: {
        type: "f",
        value: this.model.flycam.getPlaneScalingFactor(),
      },
      baseVoxel: {
        type: "f",
        value: scaleInfo.baseVoxel,
      },
      particleSize: {
        type: "f",
        value: Store.getState().userConfiguration.particleSize,
      },
      scale: {
        type: "f",
        value: Store.getState().userConfiguration.scale,
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
      this.uniforms.particleSize.value = particleSize;
      this.uniforms.scale.value = scale;
      app.vent.trigger("rerender");
    });

    this.listenTo(this.model.flycam, "zoomStepChanged", function () {
      this.uniforms.zoomFactor.value = this.model.flycam.getPlaneScalingFactor();
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
