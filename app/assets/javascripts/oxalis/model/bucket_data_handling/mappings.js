/**
 * mappings.js
 * @flow
 */

import _ from "lodash";
import * as THREE from "three";
import Store from "oxalis/store";
import Request from "libs/request";
import ErrorHandling from "libs/error_handling";
import { doWithToken } from "admin/admin_rest_api";
import { setMappingAction, setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import { createUpdatableTexture } from "oxalis/geometries/materials/abstract_plane_material_factory";
import UpdatableTexture from "libs/UpdatableTexture";
import { getRenderer } from "oxalis/controller/renderer";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import messages from "messages";
import { getMappings } from "oxalis/model/accessors/dataset_accessor";
import type { MappingType } from "oxalis/store";
import type { APIMappingType } from "admin/api_flow_types";
import type DataLayer from "oxalis/model/data_layer";

export const MAPPING_TEXTURE_WIDTH = 4096;
export const MAPPING_COLOR_TEXTURE_WIDTH = 16;

type APIMappingsType = { [string]: APIMappingType };

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
  availableMappings: Array<string>;
  mappingTexture: UpdatableTexture;
  mappingLookupTexture: UpdatableTexture;
  mappingColorTexture: UpdatableTexture;

  constructor(layerName: string) {
    const { dataset } = Store.getState();
    const datasetName = dataset.name;
    const dataStoreUrl = dataset.dataStore.url;
    this.baseUrl = `${dataStoreUrl}/data/datasets/${datasetName}/layers/${layerName}/mappings/`;
    this.availableMappings = getMappings(dataset, layerName);
  }

  getMappingNames(): Array<string> {
    return this.availableMappings;
  }

  async activateMapping(mappingName: ?string) {
    if (mappingName == null) {
      Store.dispatch(setMappingAction(null));
    } else {
      const fetchedMappings = {};
      await this.fetchMappings(mappingName, fetchedMappings);
      const [mappingObject, mappingColors] = this.buildMappingObject(mappingName, fetchedMappings);
      Store.dispatch(setMappingAction(mappingObject, mappingColors));
    }
  }

  async fetchMappings(mappingName: string, fetchedMappings: APIMappingsType): Promise<*> {
    const mapping = await this.fetchMapping(mappingName);
    if (mapping == null) return Promise.reject();
    fetchedMappings[mappingName] = mapping;
    if (mapping.parent != null) {
      return this.fetchMappings(mapping.parent, fetchedMappings);
    } else {
      return Promise.resolve();
    }
  }

  fetchMapping(mappingName: string): Promise<APIMappingType> {
    return doWithToken((token: string) => {
      console.log("Start downloading mapping:", mappingName);
      return Request.receiveJSON(`${this.baseUrl + mappingName}?token=${token}`).then(
        (mapping: APIMappingType) => {
          console.log("Done downloading mapping:", mappingName);
          return mapping;
        },
        error => console.error("Error downloading mapping:", mappingName, error),
      );
    });
  }

  buildMappingObject(
    mappingName: string,
    fetchedMappings: APIMappingsType,
  ): [MappingType, ?Array<number>] {
    const mappingObject: MappingType = {};
    let mappingColors;

    for (const currentMappingName of this.getMappingChain(mappingName, fetchedMappings)) {
      const mapping = fetchedMappings[currentMappingName];
      ErrorHandling.assertExists(mapping.classes, "Mappings must have been fetched at this point");
      if (mapping.classes) {
        for (const mappingClass of mapping.classes) {
          const minId = _.min(mappingClass);
          const mappedId = mappingObject[minId] || minId;
          for (const id of mappingClass) {
            mappingObject[id] = mappedId;
          }
        }
      }
      if (mapping.colors != null && mapping.colors.length > 0) {
        mappingColors = mapping.colors;
      }
    }
    return [mappingObject, mappingColors];
  }

  getMappingChain(mappingName: string, fetchedMappings: APIMappingsType): Array<string> {
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
    // The first byte indicates whether mappingColors are specified by the user or not
    // Then up to 255 (16*16 - 1) custom colors can be specified for mappings
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
    const float32Colors = new Float32Array(
      MAPPING_COLOR_TEXTURE_WIDTH * MAPPING_COLOR_TEXTURE_WIDTH,
    );
    const maxNumberOfColors = MAPPING_COLOR_TEXTURE_WIDTH ** 2 - 1;
    // Set the first byte to indicate whether custom mapping colors are specified or not
    float32Colors.set([mappingColors.length > 0 ? 1 : 0]);
    float32Colors.set(mappingColors.slice(0, maxNumberOfColors), 1);
    this.mappingColorTexture.update(
      float32Colors,
      0,
      0,
      MAPPING_COLOR_TEXTURE_WIDTH,
      MAPPING_COLOR_TEXTURE_WIDTH,
    );
  }

  updateMappingTextures(mapping: ?MappingType): void {
    if (mapping == null) return;

    console.log("Create mapping texture");
    console.time("Time to create mapping texture");
    // $FlowFixMe Flow chooses the wrong library definition, because it doesn't seem to know that Object.keys always returns strings and throws an error
    const keys = Uint32Array.from(Object.keys(mapping), x => parseInt(x, 10));
    keys.sort();
    // $FlowFixMe Flow doesn't recognize that mapping cannot be null or undefined :/
    const values = Uint32Array.from(keys, key => mapping[key]);
    // Instantiate the Uint8Arrays with the array buffer from the Uint32Arrays, so that each 32-bit value is converted
    // to four 8-bit values correctly
    const uint8Keys = new Uint8Array(keys.buffer);
    const uint8Values = new Uint8Array(values.buffer);
    // The typed arrays need to be padded with 0s so that their length is a multiple of MAPPING_TEXTURE_WIDTH
    const paddedLength = keys.length + MAPPING_TEXTURE_WIDTH - keys.length % MAPPING_TEXTURE_WIDTH;
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
