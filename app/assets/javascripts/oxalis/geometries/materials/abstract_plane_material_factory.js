/**
 * abstract_plane_material_factory.js
 * @flow weak
 */

import app from "app";
import Utils from "libs/utils";
import THREE from "three";
import AbstractMaterialFactory from "./abstract_material_factory";
import Model from "oxalis/model";

class AbstractPlaneMaterialFactory extends AbstractMaterialFactory {

  textures: {
    [key: string]: THREE.DataTexture;
  }
  minFilter: THREE.NearestFilter;
  maxFilter: THREE.NearestFilter;
  tWidth: number;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  constructor(model: Model, tWidth: number) {
    super(model);
    this.tWidth = tWidth;
    this.minFilter = THREE.NearestFilter;
    this.maxFilter = THREE.NearestFilter;
    this.createTextures();
  }


  setupAttributesAndUniforms() {
    super.setupAttributesAndUniforms();

    for (const binary of this.model.getColorBinaries()) {
      const name = this.sanitizeName(binary.name);
      this.uniforms[`${name}_brightness`] = {
        type: "f",
        value: this.model.datasetConfiguration.get(`layers.${binary.name}.brightness`) / 255,
      };
      this.uniforms[`${name}_contrast`] = {
        type: "f",
        value: this.model.datasetConfiguration.get(`layers.${binary.name}.contrast`),
      };
    }
  }


  makeMaterial(options) {
    super.makeMaterial(options);

    this.material.setData = (name, data) => {
      const textureName = this.sanitizeName(name);
      Utils.__guard__(this.textures[textureName], x => x.image.data.set(data));
      Utils.__guard__(this.textures[textureName], (x1) => { x1.needsUpdate = true; });
    };
  }


  setupChangeListeners() {
    this.listenTo(this.model.datasetConfiguration, "change", function (model) {
      const object = model.changed.layers || {};
      for (const binaryName of Object.keys(object)) {
        const changes = object[binaryName];
        const name = this.sanitizeName(binaryName);
        if (changes.brightness != null) {
          this.uniforms[`${name}_brightness`].value = changes.brightness / 255;
        }
        if (changes.contrast != null) {
          this.uniforms[`${name}_contrast`].value = changes.contrast;
        }
      }
      app.vent.trigger("rerender");
    });
  }


  createTextures() {
    throw new Error("Subclass responsibility");
  }


  sanitizeName(name) {
    // Make sure name starts with a letter and contains
    // no "-" signs

    if (name == null) { return null; }
    return `binary_${name.replace(/-/g, "_")}`;
  }


  createDataTexture(width, bytes) {
    const format = bytes === 1 ? THREE.LuminanceFormat : THREE.RGBFormat;

    return new THREE.DataTexture(
      new Uint8Array(bytes * width * width), width, width,
      format, THREE.UnsignedByteType,
      new THREE.UVMapping(),
      THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
      this.minFilter, this.maxFilter,
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
