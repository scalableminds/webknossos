/**
 * mappings.js
 * @flow
 */

import _ from "lodash";
import Store from "oxalis/store";
import Request from "libs/request";
import ErrorHandling from "libs/error_handling";
import type Layer from "oxalis/model/binary/layers/layer";
import type { DataStoreInfoType, MappingType } from "oxalis/store";

export type MappingArray = Array<number>;

// TODO: Non-reactive
class Mappings {
  mappings: {
    [key: string]: MappingType,
  } = {};
  baseUrl: string;
  doWithToken: Function;

  constructor(dataStoreInfo: DataStoreInfoType, layer: Layer) {
    const dataset = Store.getState().dataset;
    if (dataset == null) {
      throw new Error("Dataset needs to be available.");
    }
    const datasetName = dataset.name;
    this.mappings = _.transform(layer.mappings, (result, mappingName) => {
      result[mappingName] = { name: mappingName };
    }, {});
    this.baseUrl = `${dataStoreInfo.url}/data/datasets/${datasetName}/layers/${layer.name}/mappings/`;
    this.doWithToken = layer.doWithToken.bind(layer);
  }

  getMappingNames(): Array<string> {
    return _.keys(this.mappings);
  }

  async getMappingArrayAsync(mappingName: string): Promise<MappingArray> {
    await this.fetchMappings(mappingName);
    return this.buildMappingArray(mappingName);
  }


  async fetchMappings(mappingName: string): Promise<*> {
    const mapping = await this.fetchMapping(mappingName);
    if (mapping.parent != null) {
      return await this.fetchMappings(mapping.parent);
    } else {
      return Promise.resolve();
    }
  }


  fetchMapping(mappingName: string): Promise<MappingType> {
    const mappingObject = this.mappings[mappingName];
    if (mappingObject != null && mappingObject.classes != null) {
      return Promise.resolve(mappingObject);
    }
    return this.doWithToken((token: string) =>
      Request.receiveJSON(`${this.baseUrl + mappingName}?token=${token}`).then(
        (mapping: MappingType) => {
          this.mappings[mappingName] = mapping;
          console.log("Done downloading:", mappingName);
          return mapping;
        },
        error => console.error("Error downloading:", mappingName, error),
      ),
    );
  }

  buildMappingArray(mappingName: string): MappingArray {
    const mappingArray: MappingArray = [];

    for (const currentMappingName of this.getMappingChain(mappingName)) {
      const mappingObject = this.mappings[currentMappingName];
      ErrorHandling.assert(
        mappingObject.classes,
        "mappingObject classes must have been fetched at this point",
      );
      if (mappingObject.classes) {
        for (const mappingClass of mappingObject.classes) {
          const minId = _.min(mappingClass);
          const mappedId = mappingArray[minId] || minId;
          for (const id of mappingClass) {
            mappingArray[id] = mappedId;
          }
        }
      }
    }

    return mappingArray;
  }

  getMappingChain(mappingName: string): Array<string> {
    const chain = [mappingName];
    const mappingObject = this.mappings[mappingName];
    const parentMappingName = mappingObject.parent;

    if (parentMappingName != null) {
      return chain.concat(this.getMappingChain(parentMappingName));
    }
    return chain;
  }
}

export default Mappings;
