/**
 * mappings.js
 * @flow
 */

import * as THREE from "three";
import _ from "lodash";

import type { APIMapping } from "admin/api_flow_types";
import { createUpdatableTexture } from "oxalis/geometries/materials/plane_material_factory_helpers";
import { doWithToken } from "admin/admin_rest_api";
import { getMappings, getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { getRenderer } from "oxalis/controller/renderer";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { setMappingAction, setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import type DataLayer from "oxalis/model/data_layer";
import ErrorHandling from "libs/error_handling";
import Request from "libs/request";
import Store, { type Mapping } from "oxalis/store";
import UpdatableTexture from "libs/UpdatableTexture";
import messages from "messages";

export const MAPPING_TEXTURE_WIDTH = 4096;
export const MAPPING_COLOR_TEXTURE_WIDTH = 16;

type APIMappings = { [string]: APIMapping };

// For now, since we have no UI for this
export function setupGlobalMappingsObject(segmentationLayer: DataLayer) {
  return {
    getAll(): string[] {
      return segmentationLayer.mappings.getMappingNames();
    },
    getActive(): ?string {
      return segmentationLayer.activeMapping;
    },
    activate(mapping: string) {
      return segmentationLayer.setActiveMapping(mapping);
    },
  };
}

class Mappings {
  baseUrl: string;
  layerName: string;
  mappingTexture: UpdatableTexture;
  mappingLookupTexture: UpdatableTexture;
  mappingColorTexture: UpdatableTexture;

  constructor(layerName: string) {
    const { dataset } = Store.getState();
    const organizationName = dataset.owningOrganization;
    const datasetName = dataset.name;
    const dataStoreUrl = dataset.dataStore.url;
    this.layerName = layerName;
    this.baseUrl = `${dataStoreUrl}/data/datasets/${organizationName}/${datasetName}/layers/${layerName}/mappings/`;
  }

  getMappingNames(): Array<string> {
    return getMappings(Store.getState().dataset, this.layerName);
  }

  async activateMapping(mappingName: ?string) {
    if (mappingName == null) {
      Store.dispatch(setMappingAction(null));
    } else {
      const fetchedMappings = {};
      await this.fetchMappings(mappingName, fetchedMappings);
      const { hideUnmappedIds, colors: mappingColors } = fetchedMappings[mappingName];
      // If custom colors are specified for a mapping, assign the mapped ids specifically, so that the first equivalence
      // class will get the first color, and so on
      const assignNewIds = mappingColors != null && mappingColors.length > 0;
      const mappingObject = this.buildMappingObject(mappingName, fetchedMappings, assignNewIds);
      Store.dispatch(setMappingAction(mappingObject, mappingColors, hideUnmappedIds));
    }
  }

  async fetchMappings(mappingName: string, fetchedMappings: APIMappings): Promise<void> {
    const mapping = await this.fetchMapping(mappingName);
    if (mapping == null) return Promise.reject();
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
  ): Mapping {
    const mappingObject: Mapping = {};

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
          }
          newMappedId++;
        }
      }
    }
    return mappingObject;
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
      mapping => this.updateMappingTextures(mapping),
    );

    listenToStoreProperty(
      state => state.temporaryConfiguration.activeMapping.mappingColors,
      mappingColors => this.updateMappingColorTexture(mappingColors),
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

  updateMappingTextures(mapping: ?Mapping): void {
    if (mapping == null) return;

    console.log("Create mapping texture");
    console.time("Time to create mapping texture");
    // $FlowFixMe Flow chooses the wrong library definition, because it doesn't seem to know that Object.keys always returns strings and throws an error
    const keys = Uint32Array.from(Object.keys(mapping), x => parseInt(x, 10));
    keys.sort((a, b) => a - b);
    // $FlowFixMe Flow doesn't recognize that mapping cannot be null or undefined :/
    const values = Uint32Array.from(keys, key => mapping[key]);
    // Instantiate the Uint8Arrays with the array buffer from the Uint32Arrays, so that each 32-bit value is converted
    // to four 8-bit values correctly
    const uint8Keys = new Uint8Array(keys.buffer);
    const uint8Values = new Uint8Array(values.buffer);
    // The typed arrays need to be padded with 0s so that their length is a multiple of MAPPING_TEXTURE_WIDTH
    const paddedLength =
      keys.length + MAPPING_TEXTURE_WIDTH - (keys.length % MAPPING_TEXTURE_WIDTH);
    // The length of typed arrays cannot be changed, so we need to create new ones with the correct length
    const uint8KeysPadded = new Uint8Array(paddedLength * 4);
    uint8KeysPadded.set(uint8Keys);
    const uint8ValuesPadded = new Uint8Array(paddedLength * 4);
    uint8ValuesPadded.set(uint8Values);
    console.timeEnd("Time to create mapping texture");

    const mappingSize = keys.length;
    if (mappingSize > MAPPING_TEXTURE_WIDTH ** 2) {
      throw new Error(messages["mapping.too_big"]);
    }

    this.mappingLookupTexture.update(
      uint8KeysPadded,
      0,
      0,
      MAPPING_TEXTURE_WIDTH,
      uint8KeysPadded.length / MAPPING_TEXTURE_WIDTH / 4,
    );
    this.mappingTexture.update(
      uint8ValuesPadded,
      0,
      0,
      MAPPING_TEXTURE_WIDTH,
      uint8ValuesPadded.length / MAPPING_TEXTURE_WIDTH / 4,
    );

    Store.dispatch(setMappingEnabledAction(true));
  }

  getMappingTextures() {
    if (this.mappingTexture == null) {
      this.setupMappingTextures();
    }
    return [this.mappingTexture, this.mappingLookupTexture, this.mappingColorTexture];
  }
}

export default Mappings;
