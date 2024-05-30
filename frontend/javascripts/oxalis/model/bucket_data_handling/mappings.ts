import * as THREE from "three";
import { getMappings, getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { finishMappingInitializationAction } from "oxalis/model/actions/settings_actions";
import type { Mapping } from "oxalis/store";
import Store from "oxalis/store";
import UpdatableTexture from "libs/UpdatableTexture";
import { CuckooTableUint64 } from "libs/cuckoo/cuckoo_table_uint64";
import * as Utils from "libs/utils";
import { message } from "antd";

export const MAPPING_TEXTURE_WIDTH = 4096;
export const MAPPING_MESSAGE_KEY = "mappings";

class Mappings {
  layerName: string;
  mappingTexture!: UpdatableTexture;
  mappingLookupTexture!: UpdatableTexture;
  cuckooTable: CuckooTableUint64 | null = null;

  constructor(layerName: string) {
    this.layerName = layerName;
  }

  getMappingNames(): Array<string> {
    return getMappings(Store.getState().dataset, this.layerName);
  }

  // MAPPING TEXTURES
  setupMappingTextures() {
    this.cuckooTable = new CuckooTableUint64(MAPPING_TEXTURE_WIDTH);

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
    if (this.cuckooTable == null) {
      throw new Error("cuckooTable null when updateMappingTextures was called.");
    }

    // todo: find out what part of the mapping changed and then remove/add entries
    // based on that diff? for performance...
    for (const [key, value] of mapping.entries()) {
      const keyTuple = Utils.convertNumberTo64BitTuple(key);
      const valueTuple = Utils.convertNumberTo64BitTuple(value);

      this.cuckooTable.set(keyTuple, valueTuple);
    }

    message.destroy(MAPPING_MESSAGE_KEY);
    Store.dispatch(finishMappingInitializationAction(this.layerName));
  }

  getCuckooTable() {
    if (this.cuckooTable == null) {
      this.setupMappingTextures();
    }
    if (this.cuckooTable == null) {
      throw new Error("cuckooTable null after setupMappingTextures was called.");
    }

    return this.cuckooTable;
  }
}

export default Mappings;
