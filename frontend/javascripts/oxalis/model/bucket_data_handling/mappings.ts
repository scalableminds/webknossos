import {
  getMappings,
  getMappingInfo,
  getElementClass,
} from "oxalis/model/accessors/dataset_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { finishMappingInitializationAction } from "oxalis/model/actions/settings_actions";
import type { Mapping } from "oxalis/store";
import Store from "oxalis/store";
import UpdatableTexture from "libs/UpdatableTexture";
import { CuckooTableUint64 } from "libs/cuckoo/cuckoo_table_uint64";
import { CuckooTableUint32 } from "libs/cuckoo/cuckoo_table_uint32";
import * as Utils from "libs/utils";
import { message } from "antd";

export const MAPPING_TEXTURE_WIDTH = 4096;
export const MAPPING_MESSAGE_KEY = "mappings";

class Mappings {
  layerName: string;
  mappingTexture!: UpdatableTexture;
  mappingLookupTexture!: UpdatableTexture;
  cuckooTable: CuckooTableUint64 | CuckooTableUint32 | null = null;

  constructor(layerName: string) {
    this.layerName = layerName;
  }

  getMappingNames(): Array<string> {
    return getMappings(Store.getState().dataset, this.layerName);
  }

  // MAPPING TEXTURES
  setupMappingTextures() {
    this.cuckooTable = this.is64Bit()
      ? new CuckooTableUint64(MAPPING_TEXTURE_WIDTH)
      : new CuckooTableUint32(MAPPING_TEXTURE_WIDTH);

    listenToStoreProperty(
      (state) =>
        getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, this.layerName).mapping,
      (mapping) => {
        this.updateMappingTextures(mapping);
      },
      true,
    );
  }

  is64Bit() {
    const elementClass = getElementClass(Store.getState().dataset, this.layerName);
    return elementClass === "uint64" || elementClass === "int64";
  }

  async updateMappingTextures(mapping: Mapping | null | undefined): Promise<void> {
    if (mapping == null) return;
    if (this.cuckooTable == null) {
      throw new Error("cuckooTable null when updateMappingTextures was called.");
    }

    // todo: find out what part of the mapping changed and then remove/add entries
    // based on that diff? for performance...

    if (this.is64Bit()) {
      const cuckooTable = this.cuckooTable as CuckooTableUint64;
      for (const [key, value] of mapping.entries()) {
        const keyTuple = Utils.convertNumberTo64BitTuple(key);
        const valueTuple = Utils.convertNumberTo64BitTuple(value);

        cuckooTable.set(keyTuple, valueTuple);
      }
    } else {
      const cuckooTable = this.cuckooTable as CuckooTableUint32;
      for (const [key, value] of mapping.entries()) {
        cuckooTable.set(key as number, value as number);
      }
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
