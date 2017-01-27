/**
 * abstract_material_factory.js
 * @flow weak
 */

import _ from "lodash";
import Backbone from "backbone";
import * as THREE from "three";
import Model from "oxalis/model";

type Uniform = {
  type: string,
  value: any,
};

type Uniforms = {
  [key: string]: Uniform,
};

class AbstractMaterialFactory {

  model: Model;
  material: THREE.ShaderMaterial;
  uniforms: Uniforms;
  attributes: Object;

  constructor(model: Model) {
    this.model = model;
    _.extend(this, Backbone.Events);

    this.setupUniforms();
    this.makeMaterial();
    this.setupChangeListeners();
  }


  setupUniforms() {
    this.uniforms = {};
  }


  makeMaterial(options = {}) {
    options = _.extend(options, {
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
    });

    this.material = new THREE.ShaderMaterial(options);
  }


  setupChangeListeners() {}


  getMaterial() {
    return this.material;
  }


  getVertexShader() {}


  getFragmentShader() {}
}


export default AbstractMaterialFactory;
