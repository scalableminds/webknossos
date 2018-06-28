/**
 * abstract_plane_material_factory.js
 * @flow
 */

import _ from "lodash";
import * as THREE from "three";
import UpdatableTexture from "libs/UpdatableTexture";
import app from "app";
import Store from "oxalis/store";
import type { DatasetLayerConfigurationType } from "oxalis/store";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import shaderEditor from "oxalis/model/helpers/shader_editor";
import { getColorLayers } from "oxalis/model/accessors/dataset_accessor";

export type TextureMapType = {
  [key: string]: THREE.DataTexture,
};

export type UniformsType = {
  [key: string]: {
    type: "f" | "i" | "t" | "v2" | "v3" | "tv",
    value: any,
  },
};

export type ShaderMaterialOptionsType = {
  polygonOffset?: boolean,
  polygonOffsetFactor?: number,
  polygonOffsetUnits?: number,
};

export function createDataTexture(
  width: number,
  bytes: number,
  optUseFloat: boolean = false,
  minFilter: THREE.NearestFilter,
  maxFilter: THREE.NearestFilter,
): THREE.DataTexture {
  const format = bytes === 1 ? THREE.LuminanceFormat : THREE.RGBFormat;

  const newTexture = new THREE.DataTexture(
    new (optUseFloat ? Float32Array : Uint8Array)(bytes * width * width),
    width,
    width,
    format,
    optUseFloat ? THREE.FloatType : THREE.UnsignedByteType,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    minFilter,
    maxFilter,
  );

  return newTexture;
}

export function createUpdatableTexture(
  width: number,
  channelCount: number,
  type: THREE.FloatType | THREE.UnsignedByteType | THREE.Uint32BufferAttribute,
  renderer: THREE.WebGLRenderer,
): UpdatableTexture {
  let format;
  if (channelCount === 1) {
    format = THREE.LuminanceFormat;
  } else if (channelCount === 2) {
    format = THREE.LuminanceAlphaFormat;
  } else if (channelCount === 3) {
    format = THREE.RGBFormat;
  } else if (channelCount === 4) {
    format = THREE.RGBAFormat;
  } else {
    throw new Error(`Unhandled byte count: ${channelCount}`);
  }

  const newTexture = new UpdatableTexture(
    width,
    width,
    format,
    type,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.NearestFilter,
    THREE.NearestFilter,
  );
  newTexture.setRenderer(renderer);
  newTexture.setSize(width, width);

  return newTexture;
}

export function sanitizeName(name: ?string): string {
  // Make sure name starts with a letter and contains
  // no "-" signs

  if (name == null) {
    return "";
  }
  return `layer_${name.replace(/-/g, "_")}`;
}

class AbstractPlaneMaterialFactory {
  material: THREE.ShaderMaterial;
  uniforms: UniformsType;
  attributes: Object;
  textures: TextureMapType;
  minFilter: THREE.NearestFilter;
  maxFilter: THREE.NearestFilter;
  shaderId: number;

  constructor(shaderId: number) {
    this.minFilter = THREE.NearestFilter;
    this.maxFilter = THREE.NearestFilter;
    this.shaderId = shaderId;
  }

  setup() {
    this.setupUniforms();
    this.makeMaterial();
    this.attachTextures(this.textures);
    this.setupChangeListeners();
    return this;
  }

  /* eslint-disable no-unused-vars */
  attachTextures(textures: TextureMapType): void {}

  setupUniforms(): void {
    this.uniforms = {};

    for (const colorLayer of getColorLayers(Store.getState().dataset)) {
      const name = sanitizeName(colorLayer.name);
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
    this.material = new THREE.ShaderMaterial(
      _.extend(options, {
        uniforms: this.uniforms,
        vertexShader: this.getVertexShader(),
        fragmentShader: this.getFragmentShader(),
      }),
    );

    shaderEditor.addMaterial(this.shaderId, this.material);

    this.material.setData = (name, data) => {
      const textureName = sanitizeName(name);
      const texture = this.textures[textureName];
      if (texture) {
        texture.image.data = data;
        texture.needsUpdate = true;
      }
    };
  }

  setupChangeListeners(): void {
    listenToStoreProperty(
      state => state.datasetConfiguration.layers,
      layerSettings => {
        for (const colorLayer of getColorLayers(Store.getState().dataset)) {
          const settings = layerSettings[colorLayer.name];
          if (settings != null) {
            const name = sanitizeName(colorLayer.name);
            this.updateUniformsForLayer(settings, name);
          }
        }

        app.vent.trigger("rerender");
      },
      true,
    );
  }

  updateUniformsForLayer(settings: DatasetLayerConfigurationType, name: string) {
    this.uniforms[`${name}_brightness`].value = settings.brightness / 255;
    this.uniforms[`${name}_contrast`].value = settings.contrast;
  }

  getMaterial(): THREE.ShaderMaterial {
    return this.material;
  }

  getFragmentShader(): string {
    return "";
  }

  getVertexShader(): string {
    return `
precision highp float;

varying vec4 worldCoord;
varying vec4 modelCoord;
varying vec2 vUv;
varying mat4 savedModelMatrix;

void main() {
  vUv = uv;
  modelCoord = vec4(position, 1.0);
  savedModelMatrix = modelMatrix;
  worldCoord = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
  }
}

export default AbstractPlaneMaterialFactory;
