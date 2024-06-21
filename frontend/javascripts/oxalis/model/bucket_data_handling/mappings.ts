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
import { message } from "antd";
import { cachedDiffMappings } from "../sagas/mapping_saga";

export const MAPPING_TEXTURE_WIDTH = 4096;
export const MAPPING_MESSAGE_KEY = "mappings";

class Mappings {
  layerName: string;
  mappingTexture!: UpdatableTexture;
  mappingLookupTexture!: UpdatableTexture;
  cuckooTable: CuckooTableUint64 | CuckooTableUint32 | null = null;
  previousMapping: Mapping | null | undefined = null;

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

    const { changed, onlyA, onlyB } =
      this.previousMapping != null
        ? cachedDiffMappings(this.previousMapping, mapping)
        : { changed: [], onlyA: [], onlyB: Array.from(mapping.keys() as Iterable<number>) };

    const cuckooTable = this.cuckooTable;
    for (const keyToDelete of onlyA) {
      // @ts-ignore keyToDelete will be either number or bigint depending on the context
      cuckooTable.utilUnset(keyToDelete);
    }
    for (const key of changed) {
      // @ts-ignore key will be either number or bigint depending on the context
      cuckooTable.utilSet(key, mapping.get(key));
    }
    for (const key of onlyB) {
      // @ts-ignore key will be either number or bigint depending on the context
      cuckooTable.utilSet(key, mapping.get(key));
    }
    this.previousMapping = mapping;

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
