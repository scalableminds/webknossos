import * as THREE from "three";
import { message } from "antd";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";
import { getMappings, getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import { getRenderer } from "oxalis/controller/renderer";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { finishMappingInitializationAction } from "oxalis/model/actions/settings_actions";
import type { Mapping } from "oxalis/store";
import Store from "oxalis/store";
import UpdatableTexture from "libs/UpdatableTexture";
import messages from "messages";

export const MAPPING_TEXTURE_WIDTH = 4096;
export const MAPPING_MESSAGE_KEY = "mappings";

class Mappings {
  layerName: string;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'mappingTexture' has no initializer and i... Remove this comment to see the full error message
  mappingTexture: UpdatableTexture;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'mappingLookupTexture' has no initializer... Remove this comment to see the full error message
  mappingLookupTexture: UpdatableTexture;

  constructor(layerName: string) {
    this.layerName = layerName;
  }

  getMappingNames(): Array<string> {
    return getMappings(Store.getState().dataset, this.layerName);
  }

  // MAPPING TEXTURES
  setupMappingTextures() {
    const renderer = getRenderer();
    this.mappingTexture = createUpdatableTexture(
      MAPPING_TEXTURE_WIDTH,
      MAPPING_TEXTURE_WIDTH,
      4,
      THREE.UnsignedByteType,
      renderer,
    );
    this.mappingLookupTexture = createUpdatableTexture(
      MAPPING_TEXTURE_WIDTH,
      MAPPING_TEXTURE_WIDTH,
      4,
      THREE.UnsignedByteType,
      renderer,
    );

    listenToStoreProperty(
      (state) =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, this.layerName).mapping,
      (mapping) => {
        this.updateMappingTextures(mapping);
      },
      true,
    );
  }

  async updateMappingTextures(mapping: Mapping | null | undefined): Promise<void> {
    if (mapping == null) return;
    console.time("Time to create mapping texture");
    const mappingSize = mapping.size;
    // The typed arrays need to be padded with 0s so that their length is a multiple of MAPPING_TEXTURE_WIDTH
    const paddedLength =
      mappingSize + MAPPING_TEXTURE_WIDTH - (mappingSize % MAPPING_TEXTURE_WIDTH);
    const keys = new Uint32Array(paddedLength);
    const values = new Uint32Array(paddedLength);
    const mappingKeys: Array<number> | Array<bigint> = Array.from(
      // TS thinks Iterable<bigint> won't work with Array.from, which is why
      // we cast to Iterable<number>.
      mapping.keys() as Iterable<number>,
    );
    mappingKeys.sort((a, b) => a - b);
    keys.set(mappingKeys);
    // @ts-ignore mappingKeys are guaranteed to exist in mapping as they are mapping.keys()
    values.set(mappingKeys.map((key) => mapping.get(key)));
    // Instantiate the Uint8Arrays with the array buffer from the Uint32Arrays, so that each 32-bit value is converted
    // to four 8-bit values correctly
    const uint8Keys = new Uint8Array(keys.buffer);
    const uint8Values = new Uint8Array(values.buffer);
    console.timeEnd("Time to create mapping texture");

    if (mappingSize > MAPPING_TEXTURE_WIDTH ** 2) {
      throw new Error(messages["mapping.too_big"]);
    }

    console.time("MappingActivation");
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
    Store.dispatch(finishMappingInitializationAction(this.layerName));
    console.timeEnd("MappingActivation");
  }

  getMappingTextures() {
    if (this.mappingTexture == null) {
      this.setupMappingTextures();
    }

    if (this.mappingTexture == null || this.mappingLookupTexture == null) {
      throw new Error("Mapping textures are null after initialization.");
    }

    return [this.mappingTexture, this.mappingLookupTexture];
  }
}

export default Mappings;
