import _ from "lodash";
import {
  getDefaultLayerViewConfiguration,
  defaultDatasetViewConfiguration,
} from "types/schemas/dataset_view_configuration.schema";
import type { APIDataset, APIMaybeUnimportedDataset, APIDataLayer } from "types/api_flow_types";
import "types/api_flow_types";
import { getDefaultIntensityRangeOfLayer } from "oxalis/model/accessors/dataset_accessor";
import { validateObjectWithType } from "types/validation";

const eliminateErrors = (
  instance: Record<string, any>,
  errors: Array<any>,
  defaults: Record<string, any>,
) => {
  errors.forEach((error) => {
    if (error.name === "required") {
      instance[error.argument] = defaults[error.argument];
    } else if (error.name === "additionalProperties") {
      delete instance[error.argument];
    } else {
      const wrongPropertyPath = error.property.split(".");
      // assert();
      const invalidFieldName = wrongPropertyPath[1];

      if (defaults[invalidFieldName] === null) {
        delete instance[invalidFieldName];
      } else {
        instance[invalidFieldName] = defaults[invalidFieldName];
      }
    }
  });
};

export const getSpecificDefaultsForLayers = (dataset: APIDataset, layer: APIDataLayer) => ({
  intensityRange: getDefaultIntensityRangeOfLayer(dataset, layer.name),
  alpha: layer.category === "color" ? 100 : 20,
});
export const enforceValidatedDatasetViewConfiguration = (
  datasetViewConfiguration: Record<string, any>,
  maybeUnimportedDataset: APIMaybeUnimportedDataset,
  isOptional: boolean = false,
) => {
  const validationErrors = validateObjectWithType(
    isOptional ? "types::OptionalDatasetViewConfiguration" : "types::DatasetViewConfiguration",
    datasetViewConfiguration,
  );
  eliminateErrors(datasetViewConfiguration, validationErrors, defaultDatasetViewConfiguration);
  const { layers } = datasetViewConfiguration;
  const newLayerConfig = {};

  if (maybeUnimportedDataset.isActive) {
    const dataset: APIDataset = maybeUnimportedDataset;
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'layer' implicitly has an 'any' type.
    dataset.dataSource.dataLayers.forEach((layer) => {
      const layerConfigDefault = getDefaultLayerViewConfiguration(
        getSpecificDefaultsForLayers(dataset, layer),
      );
      const existingLayerConfig = layers[layer.name];

      if (existingLayerConfig) {
        const layerErrors = validateObjectWithType(
          isOptional ? "types::OptionalLayerViewConfiguration" : "types::LayerViewConfiguration",
          existingLayerConfig,
        );
        eliminateErrors(existingLayerConfig, layerErrors, layerConfigDefault);
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        newLayerConfig[layer.name] = existingLayerConfig;
      } else {
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        newLayerConfig[layer.name] = isOptional
          ? {}
          : _.pickBy(layerConfigDefault, (value: any) => value !== null);
      }
    });
  }

  datasetViewConfiguration.layers = newLayerConfig;
};
