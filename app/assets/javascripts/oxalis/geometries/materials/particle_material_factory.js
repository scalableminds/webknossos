/**
 * particle_material_factory.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import AbstractMaterialFactory from "./abstract_material_factory";

class ParticleMaterialFactory extends AbstractMaterialFactory {

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  setupAttributesAndUniforms() {
    super.setupAttributesAndUniforms();

    this.uniforms = _.extend(this.uniforms, {
      zoomFactor: {
        type: "f",
        value: this.model.flycam.getPlaneScalingFactor(),
      },
      baseVoxel: {
        type: "f",
        value: app.scaleInfo.baseVoxel,
      },
      particleSize: {
        type: "f",
        value: this.model.user.get("particleSize"),
      },
      scale: {
        type: "f",
        value: this.model.user.get("scale"),
      },
      showRadius: {
        type: "i",
        value: 1,
      },
      devicePixelRatio: {
        type: "f",
        value: window.devicePixelRatio || 1,
      },
    },
    );

    this.attributes = _.extend(this.attributes, {
      sizeNm: {
        type: "f",
      },
      nodeScaleFactor: {
        type: "f",
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

    this.listenTo(this.model.user, "change:particleSize", function (model, size) {
      this.uniforms.particleSize.value = size;
      app.vent.trigger("rerender");
    });
    this.listenTo(this.model.user, "change:scale", function (model, scale) {
      this.uniforms.scale.value = scale;
      app.vent.trigger("rerender");
    });
    this.listenTo(this.model.user, "change:overrideNodeRadius", () => app.vent.trigger("rerender"));

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
uniform float devicePixelRatio;
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
        ) * devicePixelRatio * scale * nodeScaleFactor;
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
