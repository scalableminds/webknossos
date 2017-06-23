/**
 * abstract_plane_material_factory.js
 * @flow
 */

import _ from "lodash";
import * as THREE from "three";
import app from "app";
import Utils from "libs/utils";
import Model from "oxalis/model";
import Store from "oxalis/store";
import type { DatasetLayerConfigurationType } from "oxalis/store";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";

export type UniformsType = {
  [key: string]: {
    type: "f" | "i" | "t" | "v2" | "v3",
    value: any,
  }
};

export type ShaderMaterialOptionsType = {
  polygonOffset?: boolean,
  polygonOffsetFactor?: number,
  polygonOffsetUnits?: number,
}

class AbstractPlaneMaterialFactory {
  material: THREE.ShaderMaterial;
  uniforms: UniformsType;
  attributes: Object;
  textures: {
    [key: string]: THREE.DataTexture;
  };
  minFilter: THREE.NearestFilter;
  maxFilter: THREE.NearestFilter;
  tWidth: number;

  constructor(tWidth: number) {
    this.setupUniforms();
    this.makeMaterial();
    this.tWidth = tWidth;
    this.minFilter = THREE.NearestFilter;
    this.maxFilter = THREE.NearestFilter;
    this.createTextures();
    this.setupChangeListeners();
  }


  setupUniforms(): void {
    this.uniforms = {};

    for (const binary of Model.getColorBinaries()) {
      const name = this.sanitizeName(binary.name);
      this.uniforms[`${name}_brightness`] = {
        type: "f",
        value: 1.0,
      };
      this.uniforms[`${name}_contrast`] = {
        type: "f",
        value: 1.0,
      };
    }
  }


  makeMaterial(options?: ShaderMaterialOptionsType): void {
    this.material = new THREE.ShaderMaterial(_.extend(options, {
      uniforms: this.uniforms,
      vertexShader: this.getVertexShader(),
      fragmentShader: this.getFragmentShader(),
    }));

    this.material.setData = (name, data) => {
      const textureName = this.sanitizeName(name);
      Utils.__guard__(this.textures[textureName], x => x.image.data.set(data));
      Utils.__guard__(this.textures[textureName], (x1) => { x1.needsUpdate = true; });
    };
  }


  setupChangeListeners(): void {
    listenToStoreProperty(
      (state) => state.datasetConfiguration.layers,
      (layerSettings) => {
        _.forEach(layerSettings, (settings, layerName) => {
          const name = this.sanitizeName(layerName);
          this.updateUniformsForLayer(settings, name);
        });

        app.vent.trigger("rerender");
      },
      true
    );
  }

  updateUniformsForLayer(settings: DatasetLayerConfigurationType, name: string) {
    this.uniforms[`${name}_brightness`].value = settings.brightness / 255;
    this.uniforms[`${name}_contrast`].value = settings.contrast;
  }

  getMaterial(): THREE.ShaderMaterial {
    return this.material;
  }

  createTextures(): void {
    throw new Error("Subclass responsibility");
  }


  sanitizeName(name: ?string): string {
    // Make sure name starts with a letter and contains
    // no "-" signs

    if (name == null) { return ""; }
    return `binary_${name.replace(/-/g, "_")}`;
  }


  createDataTexture(width: number, bytes: number): void {
    const format = bytes === 1 ? THREE.LuminanceFormat : THREE.RGBFormat;

    return new THREE.DataTexture(
      new Uint8Array(bytes * width * width), width, width,
      format, THREE.UnsignedByteType,
      THREE.UVMapping,
      THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
      this.minFilter, this.maxFilter,
    );
  }

  getFragmentShader(): string {
    throw new Error("Subclass responsibility");
  }


  getVertexShader(): string {
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
