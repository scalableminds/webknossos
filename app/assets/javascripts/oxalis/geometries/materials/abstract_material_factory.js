import _ from "lodash";
import Backbone from "backbone";
import * as THREE from "three";

class AbstractMaterialFactory {


  constructor(model) {
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
