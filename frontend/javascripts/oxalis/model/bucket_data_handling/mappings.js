/**
 * mappings.js
 * @flow
 */

import * as THREE from "three";
import _ from "lodash";

import type { APIMapping } from "types/api_flow_types";
import type { ProgressCallback } from "libs/progress_callback";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";
import { doWithToken } from "admin/admin_rest_api";
import { getMappings, getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { getRenderer } from "oxalis/controller/renderer";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { setMappingAction, setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import type DataLayer from "oxalis/model/data_layer";
import ErrorHandling from "libs/error_handling";
import Request from "libs/request";
import Store, { type Mapping, type MappingType } from "oxalis/store";
import UpdatableTexture from "libs/UpdatableTexture";
import messages from "messages";
import { trackAction } from "oxalis/model/helpers/analytics";

export const MAPPING_TEXTURE_WIDTH = 4096;
export const MAPPING_COLOR_TEXTURE_WIDTH = 16;

type APIMappings = { [string]: APIMapping };

// For now, since we have no UI for this
export function setupGlobalMappingsObject(segmentationLayer: DataLayer) {
  return {
    getAll(): string[] {
      trackAction("Deprecated mapping usage (getAll)");
      console.warn(
        "Using mappings.getAll() is deprecated. Please use the official front-end API function getMappingNames() instead.",
      );
      return segmentationLayer.mappings != null ? segmentationLayer.mappings.getMappingNames() : [];
    },
    getActive(): ?string {
      trackAction("Deprecated mapping usage (getActive)");
      console.warn(
        "Using mappings.getActive() is deprecated. Please use the official front-end API function getActiveMapping() instead.",
      );
      return segmentationLayer.activeMapping;
    },
    activate(mapping: string) {
      trackAction("Deprecated mapping usage (activate)");
      console.warn(
        "Using mappings.activate() is deprecated. Please use the official front-end API function activateMapping() instead.",
      );
      return segmentationLayer.setActiveMapping(mapping, "JSON");
    },
  };
}

const noopProgressCallback = async (_a, _b) => ({ hideFn: () => {} });

class Mappings {
  baseUrl: string;
  layerName: string;
  mappingTexture: typeof UpdatableTexture;
  mappingLookupTexture: typeof UpdatableTexture;
  mappingColorTexture: typeof UpdatableTexture;
  progressCallback: ProgressCallback;

  constructor(layerName: string, fallbackLayerName: ?string) {
    const { dataset } = Store.getState();
    const organizationName = dataset.owningOrganization;
    const datasetName = dataset.name;
    const dataStoreUrl = dataset.dataStore.url;
    // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
    const mappingLayerName = fallbackLayerName != null ? fallbackLayerName : layerName;
    this.layerName = layerName;
    this.baseUrl = `${dataStoreUrl}/data/datasets/${organizationName}/${datasetName}/layers/${mappingLayerName}/mappings/`;
    this.progressCallback = noopProgressCallback;
    setTimeout(() => this.registerReloadHandler(), 5000);
  }

  registerReloadHandler() {
    let oldMapping = null;
    const isAgglomerate = mapping => {
      if (!mapping) {
        return false;
      }
      return mapping.mappingType === "HDF5";
    };

    listenToStoreProperty(
      state => state.temporaryConfiguration.activeMapping,
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
    );
  }

  getMappingNames(): Array<string> {
    return getMappings(Store.getState().dataset, this.layerName);
  }

  async activateMapping(
    mappingName: ?string,
    mappingType: MappingType,
    _progressCallback?: ProgressCallback,
  ) {
    this.progressCallback = _progressCallback || noopProgressCallback;
    const progressCallback = this.progressCallback;
    if (mappingName == null) {
      Store.dispatch(setMappingAction(null));
      return;
    }

    if (mappingType === "HDF5") {
      Store.dispatch(setMappingAction(mappingName, null, null, null, false, mappingType));
      Store.dispatch(setMappingEnabledAction(true));
      return;
    }

    // Handle JSON mapping
    const fetchedMappings = {};
    await progressCallback(false, "Downloading mapping...");
    await this.fetchMappings(mappingName, fetchedMappings);
    const { hideUnmappedIds, colors: mappingColors } = fetchedMappings[mappingName];
    // If custom colors are specified for a mapping, assign the mapped ids specifically, so that the first equivalence
    // class will get the first color, and so on
    const assignNewIds = mappingColors != null && mappingColors.length > 0;
    await progressCallback(false, "Building mapping structure...");
    const [mappingObject, mappingKeys] = this.buildMappingObject(
      mappingName,
      fetchedMappings,
      assignNewIds,
    );
    await progressCallback(false, "Applying mapping...");
    Store.dispatch(
      setMappingAction(
        mappingName,
        mappingObject,
        mappingKeys,
        mappingColors,
        hideUnmappedIds,
        mappingType,
      ),
    );
  }

  async fetchMappings(mappingName: string, fetchedMappings: APIMappings): Promise<void> {
    const mapping = await this.fetchMapping(mappingName);
    if (mapping == null) return Promise.reject(new Error("Mapping was null."));
    fetchedMappings[mappingName] = mapping;
    if (mapping.parent != null) {
      return this.fetchMappings(mapping.parent, fetchedMappings);
    } else {
      return Promise.resolve();
    }
  }

  fetchMapping(mappingName: string): Promise<APIMapping> {
    return doWithToken((token: string) => {
      console.log("Start downloading mapping:", mappingName);
      return Request.receiveJSON(`${this.baseUrl + mappingName}?token=${token}`).then(
        (mapping: APIMapping) => {
          console.log("Done downloading mapping:", mappingName);
          return mapping;
        },
        error => console.error("Error downloading mapping:", mappingName, error),
      );
    });
  }

  getLargestSegmentId(): number {
    const segmentationLayer = getLayerByName(Store.getState().dataset, this.layerName);
    if (segmentationLayer.category !== "segmentation") {
      throw new Error("Mappings class must be instantiated with a segmentation layer.");
    }
    return segmentationLayer.largestSegmentId;
  }

  buildMappingObject(
    mappingName: string,
    fetchedMappings: APIMappings,
    assignNewIds: boolean,
  ): [Mapping, Array<number>] {
    const mappingObject: Mapping = {};
    // Performance optimization: Object.keys(...) is slow for large objects
    // keeping track of the keys in a separate array is ~5x faster
    const mappingKeys = [];

    const maxId = this.getLargestSegmentId() + 1;
    // Initialize to the next multiple of 256 that is larger than maxId
    let newMappedId = Math.ceil(maxId / 256) * 256;
    for (const currentMappingName of this.getMappingChain(mappingName, fetchedMappings)) {
      const mapping = fetchedMappings[currentMappingName];
      ErrorHandling.assertExists(mapping.classes, "Mappings must have been fetched at this point");

      if (mapping.classes) {
        for (const mappingClass of mapping.classes) {
          const minId = assignNewIds ? newMappedId : _.min(mappingClass);
          const mappedId = mappingObject[minId] || minId;
          for (const id of mappingClass) {
            mappingObject[id] = mappedId;
            mappingKeys.push(id);
          }
          newMappedId++;
        }
      }
    }
    mappingKeys.sort((a, b) => a - b);
    return [mappingObject, mappingKeys];
  }

  getMappingChain(mappingName: string, fetchedMappings: APIMappings): Array<string> {
    const chain = [mappingName];
    const mapping = fetchedMappings[mappingName];
    const parentMappingName = mapping.parent;

    if (parentMappingName != null) {
      return chain.concat(this.getMappingChain(parentMappingName, fetchedMappings));
    }
    return chain;
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

    listenToStoreProperty(
      state => state.temporaryConfiguration.activeMapping.mapping,
      mapping => {
        const { mappingKeys } = Store.getState().temporaryConfiguration.activeMapping;
        this.updateMappingTextures(mapping, mappingKeys);
      },
    );

    // updateMappingColorTexture has to be called at least once to guarantee
    // proper initialization of the texture with -1.
    // There is a race condition otherwise leading to hard-to-debug errors.
    listenToStoreProperty(
      state => state.temporaryConfiguration.activeMapping.mappingColors,
      mappingColors => this.updateMappingColorTexture(mappingColors),
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
    const progressCallback = this.progressCallback;

    await progressCallback(false, "Create mapping texture...");
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

    await progressCallback(false, "Copy mapping data to GPU...");
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
    await progressCallback(true, "Mapping successfully applied.");
    Store.dispatch(setMappingEnabledAction(true));

    // Reset progressCallback, so it doesn't trigger when setting mappings
    // programmatically, later, e.g. in merger mode
    this.progressCallback = noopProgressCallback;
  }

  getMappingTextures() {
    if (this.mappingTexture == null) {
      this.setupMappingTextures();
    }
    return [this.mappingTexture, this.mappingLookupTexture, this.mappingColorTexture];
  }
}

export default Mappings;
