import app from "app";
import THREE from "three";
import AbstractMaterialFactory from "./abstract_material_factory";

class AbstractPlaneMaterialFactory extends AbstractMaterialFactory {


  constructor(model, tWidth) {

    this.model = model;
    this.tWidth = tWidth;
    _.extend(this, Backbone.Events);

    this.minFilter = THREE.NearestFilter;
    this.maxFilter = THREE.NearestFilter;
    super(this.model);
  }


  setupAttributesAndUniforms() {

    super.setupAttributesAndUniforms();

    for (let binary of this.model.getColorBinaries()) {
      const name = this.sanitizeName(binary.name);
      this.uniforms[name + "_brightness"] = {
        type : "f",
        value : this.model.datasetConfiguration.get(`layers.${binary.name}.brightness`) / 255
      };
      this.uniforms[name + "_contrast"] = {
        type : "f",
        value : this.model.datasetConfiguration.get(`layers.${binary.name}.contrast`)
      };
    }


    return this.createTextures();
  }


  makeMaterial(options) {

    super.makeMaterial(options);

    return this.material.setData = (name, data) => {
      const textureName = this.sanitizeName(name);
      __guard__(this.textures[textureName], x => x.image.data.set(data));
      return __guard__(this.textures[textureName], x1 => x1.needsUpdate = true);
    };
  }


  setupChangeListeners() {

    return this.listenTo(this.model.datasetConfiguration, "change", function(model) {

      const object = model.changed.layers || {};
      for (let binaryName in object) {
        const changes = object[binaryName];
        const name = this.sanitizeName(binaryName);
        if (changes.brightness != null) {
          this.uniforms[name + "_brightness"].value = changes.brightness / 255;
        }
        if (changes.contrast != null) {
          this.uniforms[name + "_contrast"].value = changes.contrast;
        }
      }
      return app.vent.trigger("rerender");
    });
  }


  createTextures() {

    throw new Error("Subclass responsibility");
  }


  sanitizeName(name) {
    // Make sure name starts with a letter and contains
    // no "-" signs

    if (name == null) { return; }
    return `binary_${name.replace(/-/g, "_")}`;
  }


  createDataTexture(width, bytes) {

    const format = bytes === 1 ? THREE.LuminanceFormat : THREE.RGBFormat;

    return new THREE.DataTexture(
      new Uint8Array(bytes * width * width), width, width,
      format, THREE.UnsignedByteType,
      new THREE.UVMapping(),
      THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
      this.minFilter, this.maxFilter
    );
  }


  getVertexShader() {

    return `\
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position =   projectionMatrix *
                  modelViewMatrix *
                  vec4(position,1.0); }\
`;
  }
}

export default AbstractPlaneMaterialFactory;

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}