/**
 * mappings.js
 * @flow
 */

import _ from "lodash";
import Request from "libs/request";
import ErrorHandling from "libs/error_handling";
import type Layer, { DataStoreInfoType } from "oxalis/model/binary/layers/layer";

export type MappingArray = Array<number>;

export type MappingType = {
  parent: ?string;
  name: string;
  classes: ?Array<Array<number>>;
};

class Mappings {

  mappings: {
    [key: string]: MappingType,
  } = {};
  baseUrl: string;
  doWithToken: Function;

  constructor(dataStoreInfo: DataStoreInfoType, datasetName: string, layer: Layer) {
    this.mappings = _.transform(layer.mappings, (result, mappingObject) => {
      result[mappingObject.name] = mappingObject;
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


  fetchMappings(mappingName: string): Promise<*> {
    const mappingChain = this.getMappingChain(mappingName);
    return Promise.all(mappingChain.map(curMappingName => this.fetchMapping(curMappingName)));
  }


  fetchMapping(mappingName: string): Promise<?MappingType> {
    const mappingObject = this.mappings[mappingName];
    if (mappingObject != null && mappingObject.classes != null) {
      return Promise.resolve(mappingObject);
    }
    return this.doWithToken((token: string) => Request.receiveJSON(
        `${this.baseUrl + mappingName}?token=${token}`,
      ).then((mapping: MappingType) => {
        this.mappings[mappingName] = mapping;
        console.log("Done downloading:", mappingName);
        return mapping;
      }, error => console.error("Error downloading:", mappingName, error)),
    );
  }


  buildMappingArray(mappingName: string): MappingArray {
    const mappingArray: MappingArray = [];

    for (const currentMappingName of this.getMappingChain(mappingName)) {
      const mappingObject = this.mappings[currentMappingName];
      ErrorHandling.assert(mappingObject.classes,
          "mappingObject classes must have been fetched at this point");
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
