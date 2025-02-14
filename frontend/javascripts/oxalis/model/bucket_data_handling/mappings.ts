import { message } from "antd";
import type UpdatableTexture from "libs/UpdatableTexture";
import { CuckooTableUint32 } from "libs/cuckoo/cuckoo_table_uint32";
import { CuckooTableUint64 } from "libs/cuckoo/cuckoo_table_uint64";
import Toast from "libs/toast";
import { diffMaps } from "libs/utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import {
  getElementClass,
  getMappingInfo,
  getMappings,
} from "oxalis/model/accessors/dataset_accessor";
import { finishMappingInitializationAction } from "oxalis/model/actions/settings_actions";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import type { Mapping, NumberLike } from "oxalis/store";
import Store from "oxalis/store";

// With the default load factor of 0.9, this suffices for mapping
// ~15M uint32 ids.
export const MAPPING_TEXTURE_WIDTH = 4096;
export const MAPPING_MESSAGE_KEY = "mappings";

function diffMappings(
  mappingA: Mapping,
  mappingB: Mapping,
  cacheResult?: ReturnType<typeof diffMaps<NumberLike, NumberLike>>,
) {
  if (cacheResult != null) {
    return cacheResult;
  }
  return diffMaps<NumberLike, NumberLike>(mappingA, mappingB);
}

export const cachedDiffMappings = memoizeOne(
  diffMappings,
  (newInputs, lastInputs) =>
    // If cacheResult was passed, the inputs must be considered as not equal
    // so that the new result can be set
    newInputs[2] == null && newInputs[0] === lastInputs[0] && newInputs[1] === lastInputs[1],
);
export const setCacheResultForDiffMappings = (
  mappingA: Mapping,
  mappingB: Mapping,
  cacheResult: ReturnType<typeof diffMaps<NumberLike, NumberLike>>,
) => {
  cachedDiffMappings(mappingA, mappingB, cacheResult);
};

const throttledCapacityWarning = _.throttle(() => {
  const msg =
    "The mapping is becoming too large and will only be partially applied. Please zoom further in to avoid that too many segment ids are present. Also consider refreshing the page.";
  console.warn(msg);
  Toast.warning(msg);
}, 10000);

class Mappings {
  layerName: string;
  mappingTexture!: UpdatableTexture;
  mappingLookupTexture!: UpdatableTexture;
  cuckooTable: CuckooTableUint64 | CuckooTableUint32 | null = null;
  previousMapping: Mapping | null | undefined = null;
  currentKeyCount: number = 0;
  storePropertyUnsubscribers: Array<() => void> = [];

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

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) =>
          getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, this.layerName).mapping,
        (mapping) => {
          this.updateMappingTextures(mapping);
        },
        true,
      ),
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

    const totalUpdateCount = _.size(changed) + _.size(onlyA) + _.size(onlyB);
    const doFullTextureUpdate = totalUpdateCount > 10000;
    if (doFullTextureUpdate) {
      this.cuckooTable.disableAutoTextureUpdate();
    }

    for (const keyToDelete of onlyA) {
      this.cuckooTable.unsetNumberLike(keyToDelete);
      this.currentKeyCount--;
    }

    for (const key of changed) {
      // We know that the lookup of key in mapping has to succeed because
      // the diffing wouldn't have returned the id otherwise.
      const value = (mapping as Map<NumberLike, NumberLike>).get(key) as NumberLike;
      this.cuckooTable.setNumberLike(key, value);
    }

    for (const key of onlyB) {
      if (this.currentKeyCount > this.cuckooTable.getCriticalCapacity()) {
        throttledCapacityWarning();
        break;
      }
      // We know that the lookup of key in mapping has to succeed because
      // the diffing wouldn't have returned the id otherwise.
      const value = (mapping as Map<NumberLike, NumberLike>).get(key) as NumberLike;
      this.currentKeyCount++;
      this.cuckooTable.setNumberLike(key, value);
    }
    if (doFullTextureUpdate) {
      this.cuckooTable.enableAutoTextureUpdateAndFlush();
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

  destroy() {
    console.group("Mappings.destroy");
    this.storePropertyUnsubscribers.forEach((fn) => fn());
    this.storePropertyUnsubscribers = [];
    console.groupEnd();
  }
}

export default Mappings;
