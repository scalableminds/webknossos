/**
 * mappings.js
 * @flow
 */

import _ from "lodash";
import Store from "oxalis/store";
import Request from "libs/request";
import ErrorHandling from "libs/error_handling";
import { doWithToken } from "admin/admin_rest_api";
import type { DataStoreInfoType, DataLayerType } from "oxalis/store";
import type { APIMappingType } from "admin/api_flow_types";

export type MappingType = { [key: number]: number };

// TODO: Non-reactive
class Mappings {
  mappings: {
    [key: string]: APIMappingType,
  } = {};
  baseUrl: string;

  constructor(dataStoreInfo: DataStoreInfoType, layer: DataLayerType) {
    const dataset = Store.getState().dataset;
    if (dataset == null) {
      throw new Error("Dataset needs to be available.");
    }
    const datasetName = dataset.name;
    this.mappings =
      layer.mappings != null
        ? _.transform(
            layer.mappings,
            (result, mappingName) => {
              result[mappingName] = { name: mappingName };
            },
            {},
          )
        : {};
    this.baseUrl = `${dataStoreInfo.url}/data/datasets/${datasetName}/layers/${
      layer.name
    }/mappings/`;
  }

  getMappingNames(): Array<string> {
    return _.keys(this.mappings);
  }

  async getMappingAsync(mappingName: string): Promise<MappingType> {
    await this.fetchMappings(mappingName);
    return this.buildMappingObject(mappingName);
  }

  async fetchMappings(mappingName: string): Promise<*> {
    const mapping = await this.fetchMapping(mappingName);
    if (mapping.parent != null) {
      return this.fetchMappings(mapping.parent);
    } else {
      return Promise.resolve();
    }
  }

  fetchMapping(mappingName: string): Promise<APIMappingType> {
    const cachedMapping = this.mappings[mappingName];
    if (cachedMapping != null && cachedMapping.classes != null) {
      console.log("Activating:", mappingName);
      return Promise.resolve(cachedMapping);
    }
    return doWithToken((token: string) => {
      console.log("Start downloading:", mappingName);
      return Request.receiveJSON(`${this.baseUrl + mappingName}?token=${token}`).then(
        (mapping: APIMappingType) => {
          this.mappings[mappingName] = mapping;
          console.log("Done downloading:", mappingName);
          return mapping;
        },
        error => console.error("Error downloading:", mappingName, error),
      );
    });
  }

  buildMappingObject(mappingName: string): MappingType {
    const mappingObject: MappingType = {};

    for (const currentMappingName of this.getMappingChain(mappingName)) {
      const mapping = this.mappings[currentMappingName];
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
    }
    return mappingObject;
  }

  getMappingChain(mappingName: string): Array<string> {
    const chain = [mappingName];
    const mapping = this.mappings[mappingName];
    const parentMappingName = mapping.parent;

    if (parentMappingName != null) {
      return chain.concat(this.getMappingChain(parentMappingName));
    }
    return chain;
  }
}

export default Mappings;
