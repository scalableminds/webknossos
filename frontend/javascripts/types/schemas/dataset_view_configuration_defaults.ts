import _ from "lodash";
import { getDefaultValueRangeOfLayer, isColorLayer } from "oxalis/model/accessors/dataset_accessor";
import type { APIDataset, APIMaybeUnimportedDataset } from "types/api_flow_types";
import {
  defaultDatasetViewConfiguration,
  getDefaultLayerViewConfiguration,
} from "types/schemas/dataset_view_configuration.schema";
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
      const invalidFieldName = wrongPropertyPath[1];

      if (defaults[invalidFieldName] === null) {
        delete instance[invalidFieldName];
      } else {
        instance[invalidFieldName] = defaults[invalidFieldName];
      }
    }
  });
};

export const getSpecificDefaultsForLayer = (
  dataset: APIDataset,
  layerName: string,
  isColorLayer: boolean,
) => ({
  intensityRange: isColorLayer ? getDefaultValueRangeOfLayer(dataset, layerName) : undefined,
  alpha: isColorLayer ? 100 : 20,
});

export function ensureDatasetSettingsHasLayerOrder(
  datasetConfiguration: Record<string, any>,
  dataset: APIDataset,
) {
  const colorLayerNames = _.keys(datasetConfiguration.layers).filter((layerName) =>
    isColorLayer(dataset, layerName),
  );
  const onlyExistingLayers =
    datasetConfiguration?.colorLayerOrder?.filter(
      (layerName: string) => colorLayerNames.indexOf(layerName) >= 0,
    ) || [];
  if (onlyExistingLayers.length < colorLayerNames.length) {
    datasetConfiguration.colorLayerOrder = colorLayerNames;
  } else {
    datasetConfiguration.colorLayerOrder = onlyExistingLayers;
  }
}

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
    dataset.dataSource.dataLayers.forEach((layer) => {
      const layerConfigDefault = getDefaultLayerViewConfiguration(
        getSpecificDefaultsForLayer(dataset, layer.name, layer.category === "color"),
      );
      const existingLayerConfig = layers[layer.name];

      if (existingLayerConfig) {
        const layerErrors = validateObjectWithType(
          isOptional ? "types::OptionalLayerViewConfiguration" : "types::LayerViewConfiguration",
          existingLayerConfig,
        );
        eliminateErrors(existingLayerConfig, layerErrors, layerConfigDefault);
        if (layer.category === "segmentation") {
          delete existingLayerConfig.intensityRange;
        } else if (existingLayerConfig.intensityRange == null && !isOptional) {
          existingLayerConfig.intensityRange = getDefaultValueRangeOfLayer(dataset, layer.name);
        }
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
  if (maybeUnimportedDataset.isActive) {
    const dataset: APIDataset = maybeUnimportedDataset;
    ensureDatasetSettingsHasLayerOrder(datasetViewConfiguration, dataset);
  }
};
