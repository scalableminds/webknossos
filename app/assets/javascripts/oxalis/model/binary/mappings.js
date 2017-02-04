/**
 * mappings.js
 * @flow weak
 */

import _ from "lodash";
import Request from "libs/request";
import ErrorHandling from "libs/error_handling";
import Layer from "oxalis/model/binary/layers/layer";

export type MappingArray = Map<number, number>;

export type MappingType = {
  parent: ?string;
  name: string;
  classes: MappingArray;
};

class Mappings {

  mappings: {
    [key: string]: {
      mappingArray: ?MappingArray,
      mappingObject: MappingType,
    },
  };
  baseUrl: string;
  doWithToken: Function;

  constructor(dataStoreInfo, datasetName: string, layer: Layer) {
    this.mappings = _.transform(layer.mappings, (result, mapping) => {
      result[mapping.name] = {
        mappingObject: mapping,
      };
    }, {});
    this.baseUrl = `${dataStoreInfo.url}/data/datasets/${datasetName}/layers/${layer.name}/mappings/`;
    this.doWithToken = layer.doWithToken.bind(layer);
  }


  getMappingNames(): Array<string> {
    return _.keys(this.mappings);
  }


  getMappingArrayAsync(mappingName): Promise<Array<MappingArray>> {
    return this.fetchMappings(mappingName).then(() => this.getMappingArray(mappingName));
  }


  fetchMappings(mappingName: string): Promise<Array<MappingType>> {
    const mappingChain = this.getMappingChain(mappingName);
    const promises = _.map(mappingChain, curMappingName => this.fetchMapping(curMappingName));
    return Promise.all(promises);
  }


  fetchMapping(mappingName: string): Promise<?MappingType> {
    if (this.mappings[mappingName].mappingObject != null) {
      return Promise.resolve();
    }
    return this.doWithToken((token: string) => Request.receiveJSON(
        `${this.baseUrl + mappingName}?token=${token}`,
      ).then((mapping: MappingType) => {
        this.mappings[mappingName].mappingObject = mapping;
        console.log("Done downloading:", mappingName);
      }, error => console.error("Error downloading:", mappingName, error)),
    );
  }


  getMappingArray(mappingName: string): MappingArray {
    const mapping = this.mappings[mappingName];
    if (mapping.mappingArray != null) {
      return mapping.mappingArray;
    }
    mapping.mappingArray = this.buildMappingArray(mappingName);
    return mapping.mappingArray;
  }


  buildMappingArray(mappingName: string): MappingArray {
    const mappingArray: MappingArray = new Map();

    for (const currentMappingName of this.getMappingChain(mappingName)) {
      const { mappingObject } = this.mappings[currentMappingName];
      ErrorHandling.assert(mappingObject,
          "mappingObject must have been fetched at this point");

      for (const mappingClass of mappingObject.classes) {
        const minId = _.min(mappingClass);
        const mappedId = mappingArray.get(minId) || minId;

        for (const id of mappingClass) {
          mappingArray.set(id, mappedId);
        }
      }
    }

    return mappingArray;
  }


  getMappingChain(mappingName: string): Array<string> {
    const chain = [mappingName];
    let { mappingObject } = this.mappings[mappingName];
    let parentMappingName = mappingObject.parent;

    while (mappingObject != null && parentMappingName != null) {
      chain.push(parentMappingName);
      const parentMapping = this.mappings[parentMappingName];
      if (parentMapping !== null) {
        mappingObject = parentMapping.mappingObject;
        parentMappingName = mappingObject.parent;
      }
    }

    return chain;
  }
}

export default Mappings;
