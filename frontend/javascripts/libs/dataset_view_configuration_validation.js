// @flow

import jsonschema from "jsonschema";

import ViewConfigurationSchema, {
  getDefaultLayerViewConfiguration,
  defaultDatasetViewConfiguration,
} from "libs/dataset_view_configuration.schema.js";
import Store, { type DatasetConfiguration } from "oxalis/store";
import { type APIDataset, type APIDataLayer } from "admin/api_flow_types";
import { getDefaultIntensityRangeOfLayer } from "oxalis/model/accessors/dataset_accessor";

const validator = new jsonschema.Validator();
validator.addSchema(ViewConfigurationSchema, "/");

const validateWithSchema = (type: string, json: Object) => {
  const result = validator.validate(json, {
    $ref: `#/definitions/${type}`,
  });
  if (result.valid) {
    return [];
  } else {
    return result.errors;
  }
};

const eliminateErrors = (instance: Object, errors: Array<*>, defaults: Object) => {
  errors.forEach(error => {
    if (error.name === "required") {
      instance[error.argument] = defaults[error.argument];
    } else if (error.name === "additionalProperties") {
      delete instance[error.argument];
    } else {
      const [invalidFieldName] = error.property.split(".").slice(-1);
      instance[invalidFieldName] = defaults[invalidFieldName];
    }
  });
  return instance;
};

const getSpecificDefaultsForLayers = (dataset: APIDataset, layer: APIDataLayer) => ({
  intensityRange: getDefaultIntensityRangeOfLayer(dataset, layer.name),
  alpha: layer.category === "color" ? 100 : 20,
});

export const getValidatedDatasetViewConfiguration = (json: Object): DatasetConfiguration => {
  const validationErrors = validateWithSchema("types::DatasetViewConfiguration", json);
  let datasetViewConfiguration = json;
  if (validationErrors.length) {
    datasetViewConfiguration = eliminateErrors(
      datasetViewConfiguration,
      validationErrors,
      defaultDatasetViewConfiguration,
    );
  }

  const { layers } = datasetViewConfiguration;
  const { dataset } = Store.getState();
  dataset.dataSource.dataLayers.forEach(layer => {
    const layerConfigDefault = getDefaultLayerViewConfiguration(
      getSpecificDefaultsForLayers(dataset, layer),
    );

    const layerConfig = layers[layer.name];
    if (layerConfig) {
      const layerErrors = validateWithSchema("types::LayerViewConfiguration", layerConfig);

      console.log(layerErrors);
      layers[layer.name] = eliminateErrors(layerConfig, layerErrors, layerConfigDefault);
    } else {
      layers[layer.name] = layerConfigDefault;
    }
  });

  return { ...datasetViewConfiguration, layers };
};

export default validator;
