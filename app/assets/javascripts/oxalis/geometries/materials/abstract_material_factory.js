import Backbone from "backbone";
import THREE from "three";

class AbstractMaterialFactory {


  constructor(model) {

    this.model = model;
    _.extend(this, Backbone.Events);

    this.setupAttributesAndUniforms();
    this.makeMaterial();
    this.setupChangeListeners();
  }


  setupAttributesAndUniforms() {

    this.uniforms = {};
    return this.attributes = {};
  }


  makeMaterial(options) {

    if (options == null) { options = {}; }
    options = _.extend(options, {
      uniforms: this.uniforms,
      attributes: this.attributes,
      vertexShader   : this.getVertexShader(),
      fragmentShader : this.getFragmentShader()
    });

    return this.material = new THREE.ShaderMaterial(options);
  }


  setupChangeListeners() {}


  getMaterial() {

    return this.material;
  }


  getVertexShader() {}


  getFragmentShader() {}
}


export default AbstractMaterialFactory;
