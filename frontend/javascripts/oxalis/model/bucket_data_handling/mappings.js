// @flow
import * as THREE from "three";
import { message } from "antd";

import app from "app";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";
import { getMappings, getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import { getRenderer } from "oxalis/controller/renderer";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import Store, { type Mapping } from "oxalis/store";
import UpdatableTexture from "libs/UpdatableTexture";
import messages from "messages";

export const MAPPING_TEXTURE_WIDTH = 4096;
export const MAPPING_COLOR_TEXTURE_WIDTH = 16;

export const MAPPING_MESSAGE_KEY = "mappings";

// Remove soon (e.g., October 2021)
export function setupGlobalMappingsObject() {
  return {
    getAll(): string[] {
      throw new Error(
        "Using mappings.getAll() is deprecated. Please use the official front-end API function getMappingNames() instead.",
      );
    },
    getActive(): ?string {
      throw new Error(
        "Using mappings.getActive() is deprecated. Please use the official front-end API function getActiveMapping() instead.",
      );
    },
    activate(_mapping: string) {
      throw new Error(
        "Using mappings.activate() is deprecated. Please use the official front-end API function activateMapping() instead.",
      );
    },
  };
}

class Mappings {
  layerName: string;
  mappingTexture: typeof UpdatableTexture;
  mappingLookupTexture: typeof UpdatableTexture;
  mappingColorTexture: typeof UpdatableTexture;

  constructor(layerName: string) {
    this.layerName = layerName;
    app.vent.listenTo(app.vent, "webknossos:ready", this.registerReloadHandler);
  }

  registerReloadHandler = () => {
    let oldMapping = null;
    const isAgglomerate = mapping => {
      if (!mapping) {
        return false;
      }
      return mapping.mappingType === "HDF5";
    };

    listenToStoreProperty(
      state => getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, this.layerName),
      mapping => {
        const shouldReload = isAgglomerate(oldMapping) || isAgglomerate(mapping);
        oldMapping = mapping;
        if (shouldReload) {
          // We cannot use the internal_api here as this will result in a circular dependency
          window.webknossos.apiReady().then(api => {
            api.data.reloadBuckets(this.layerName);
          });
        }
      },
      true,
    );
  };

  getMappingNames(): Array<string> {
    return getMappings(Store.getState().dataset, this.layerName);
  }

  // MAPPING TEXTURES

  setupMappingTextures() {
    const renderer = getRenderer();
    this.mappingTexture = createUpdatableTexture(
      MAPPING_TEXTURE_WIDTH,
      4,
      THREE.UnsignedByteType,
      renderer,
    );
    this.mappingLookupTexture = createUpdatableTexture(
      MAPPING_TEXTURE_WIDTH,
      4,
      THREE.UnsignedByteType,
      renderer,
    );
    // Up to 256 (16*16) custom colors can be specified for mappings
    this.mappingColorTexture = createUpdatableTexture(
      MAPPING_COLOR_TEXTURE_WIDTH,
      1,
      THREE.FloatType,
      renderer,
    );

    // updateMappingColorTexture has to be called at least once to guarantee
    // proper initialization of the texture with -1.
    // There is a race condition otherwise leading to hard-to-debug errors.
    listenToStoreProperty(
      state =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, this.layerName)
          .mappingColors,
      mappingColors => this.updateMappingColorTexture(mappingColors),
      true,
    );

    listenToStoreProperty(
      state =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, this.layerName).mapping,
      mapping => {
        const { mappingKeys } = getMappingInfo(
          Store.getState().temporaryConfiguration.activeMappingByLayer,
          this.layerName,
        );
        this.updateMappingTextures(mapping, mappingKeys);
      },
      true,
    );
  }

  updateMappingColorTexture(mappingColors: ?Array<number>) {
    mappingColors = mappingColors || [];
    const maxNumberOfColors = MAPPING_COLOR_TEXTURE_WIDTH ** 2;
    const float32Colors = new Float32Array(maxNumberOfColors);
    // Initialize the array with -1
    float32Colors.fill(-1);
    float32Colors.set(mappingColors.slice(0, maxNumberOfColors));
    this.mappingColorTexture.update(
      float32Colors,
      0,
      0,
      MAPPING_COLOR_TEXTURE_WIDTH,
      MAPPING_COLOR_TEXTURE_WIDTH,
    );
  }

  async updateMappingTextures(mapping: ?Mapping, mappingKeys: ?Array<number>): Promise<void> {
    if (mapping == null || mappingKeys == null) return;

    console.time("Time to create mapping texture");
    const mappingSize = mappingKeys.length;
    // The typed arrays need to be padded with 0s so that their length is a multiple of MAPPING_TEXTURE_WIDTH
    const paddedLength =
      mappingSize + MAPPING_TEXTURE_WIDTH - (mappingSize % MAPPING_TEXTURE_WIDTH);

    const keys = new Uint32Array(paddedLength);
    const values = new Uint32Array(paddedLength);

    keys.set(mappingKeys);
    values.set(mappingKeys.map(key => mapping[key]));

    // Instantiate the Uint8Arrays with the array buffer from the Uint32Arrays, so that each 32-bit value is converted
    // to four 8-bit values correctly
    const uint8Keys = new Uint8Array(keys.buffer);
    const uint8Values = new Uint8Array(values.buffer);
    console.timeEnd("Time to create mapping texture");

    if (mappingSize > MAPPING_TEXTURE_WIDTH ** 2) {
      throw new Error(messages["mapping.too_big"]);
    }

    this.mappingLookupTexture.update(
      uint8Keys,
      0,
      0,
      MAPPING_TEXTURE_WIDTH,
      uint8Keys.length / MAPPING_TEXTURE_WIDTH / 4,
    );
    this.mappingTexture.update(
      uint8Values,
      0,
      0,
      MAPPING_TEXTURE_WIDTH,
      uint8Values.length / MAPPING_TEXTURE_WIDTH / 4,
    );

    message.destroy(MAPPING_MESSAGE_KEY);

    Store.dispatch(setMappingEnabledAction(this.layerName, true));
  }

  getMappingTextures() {
    if (this.mappingTexture == null) {
      this.setupMappingTextures();
    }
    if (
      this.mappingTexture == null ||
      this.mappingLookupTexture == null ||
      this.mappingColorTexture == null
    ) {
      throw new Error("Mapping textures are null after initialization.");
    }
    return [this.mappingTexture, this.mappingLookupTexture, this.mappingColorTexture];
  }
}

export default Mappings;
