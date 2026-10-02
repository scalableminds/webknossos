import {
  getDatasetDefaultConfiguration,
  getDatasets,
  updateDatasetDefaultConfiguration,
} from "admin/rest_api";
import { Typography } from "antd";
import type { useAppProps } from "antd/es/app/context";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import type { APIDatasetCompact } from "types/api_types";
import type { DatasetConfiguration, DatasetLayerConfiguration } from "viewer/store";

// Don't flood the server when a folder contains a lot of datasets.
const MAX_PARALLEL_UPDATES = 5;

/*
 * Creates the view configuration that should be stored for targetDataset when the view
 * configuration of sourceDataset is applied to it. The dataset-wide properties (position,
 * zoom, blend mode, ...) are copied as they are. The layer-specific properties are copied
 * on a best-effort basis: only layers which exist in both datasets under the same name and
 * with the same category are copied. Layers which only exist in the target dataset keep
 * their current configuration (the backend only updates the layers it receives).
 */
export function adaptViewConfigurationToDataset(
  sourceConfiguration: DatasetConfiguration,
  sourceDataset: APIDatasetCompact,
  targetDataset: APIDatasetCompact,
): DatasetConfiguration {
  const { layers, colorLayerOrder, nativelyRenderedLayerName, ...datasetWideConfiguration } =
    sourceConfiguration;

  const sourceColorLayerNames = new Set(sourceDataset.colorLayerNames);
  const targetColorLayerNames = new Set(targetDataset.colorLayerNames);
  const targetSegmentationLayerNames = new Set(targetDataset.segmentationLayerNames);

  const matchingLayers: Record<string, DatasetLayerConfiguration> = {};
  for (const [layerName, layerConfiguration] of Object.entries(layers || {})) {
    const targetLayerNamesOfSameCategory = sourceColorLayerNames.has(layerName)
      ? targetColorLayerNames
      : targetSegmentationLayerNames;
    if (targetLayerNamesOfSameCategory.has(layerName)) {
      matchingLayers[layerName] = layerConfiguration;
    }
  }

  // The layer order has to mention all color layers of the target dataset. Therefore, keep
  // the relative order of the shared layers and append the ones the source doesn't know.
  const matchingColorLayerOrder = (colorLayerOrder || []).filter((layerName) =>
    targetColorLayerNames.has(layerName),
  );
  const remainingColorLayerNames = targetDataset.colorLayerNames.filter(
    (layerName) => !matchingColorLayerOrder.includes(layerName),
  );

  const doesNativelyRenderedLayerExist =
    nativelyRenderedLayerName == null ||
    targetColorLayerNames.has(nativelyRenderedLayerName) ||
    targetSegmentationLayerNames.has(nativelyRenderedLayerName);

  return {
    ...datasetWideConfiguration,
    layers: matchingLayers,
    colorLayerOrder: [...matchingColorLayerOrder, ...remainingColorLayerNames],
    nativelyRenderedLayerName: doesNativelyRenderedLayerExist ? nativelyRenderedLayerName : null,
  };
}

async function updateDatasetsInBatches(
  targetDatasets: Array<APIDatasetCompact>,
  getConfigurationFor: (dataset: APIDatasetCompact) => DatasetConfiguration,
): Promise<Array<APIDatasetCompact>> {
  const failedDatasets: Array<APIDatasetCompact> = [];

  for (let index = 0; index < targetDatasets.length; index += MAX_PARALLEL_UPDATES) {
    const batch = targetDatasets.slice(index, index + MAX_PARALLEL_UPDATES);
    const results = await Promise.allSettled(
      batch.map((dataset) =>
        updateDatasetDefaultConfiguration(dataset.id, getConfigurationFor(dataset), {
          showErrorToast: false,
        }),
      ),
    );
    results.forEach((result, batchIndex) => {
      if (result.status === "rejected") {
        console.error(
          `Could not apply the view configuration to dataset ${batch[batchIndex].name}.`,
          result.reason,
        );
        failedDatasets.push(batch[batchIndex]);
      }
    });
  }

  return failedDatasets;
}

/*
 * Copies the view configuration of the given dataset to all other datasets which live in the
 * same folder and which the current user may edit.
 */
export async function applyViewConfigurationToDatasetsInFolder(
  sourceDataset: APIDatasetCompact,
  modal: useAppProps["modal"],
): Promise<void> {
  const [sourceConfiguration, datasetsInFolder] = await Promise.all([
    getDatasetDefaultConfiguration(sourceDataset.id),
    getDatasets(null, sourceDataset.folderId),
  ]);
  const targetDatasets = datasetsInFolder.filter(
    (dataset) => dataset.id !== sourceDataset.id && dataset.isActive && dataset.isEditable,
  );

  if (targetDatasets.length === 0) {
    Toast.warning(
      `There are no other datasets in this folder to which the view configuration of ${sourceDataset.name} could be applied.`,
    );
    return;
  }

  const datasetCountLabel = `${targetDatasets.length} ${pluralize("dataset", targetDatasets.length)}`;
  // The OK button stays in a loading state until onOk resolves.
  await modal.confirm({
    title: "Apply View Configuration",
    content: (
      <>
        <Typography.Paragraph>
          The view configuration of <Typography.Text strong>{sourceDataset.name}</Typography.Text>{" "}
          (position, zoom, layer colors, intensity ranges, ...) will be applied to the other{" "}
          {datasetCountLabel} in this folder, overwriting their current view configuration.
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          Layer settings are only copied to layers of the same name and category. Layers which don't
          exist in {sourceDataset.name} are left untouched.
        </Typography.Paragraph>
      </>
    ),
    okText: `Apply to ${datasetCountLabel}`,
    onOk: async () => {
      const failedDatasets = await updateDatasetsInBatches(targetDatasets, (targetDataset) =>
        adaptViewConfigurationToDataset(sourceConfiguration, sourceDataset, targetDataset),
      );
      const successCount = targetDatasets.length - failedDatasets.length;

      if (failedDatasets.length > 0) {
        Toast.error(
          `Could not apply the view configuration to ${failedDatasets.length} of ${datasetCountLabel}.`,
          {},
          failedDatasets.map((dataset) => dataset.name).join(", "),
        );
      }
      if (successCount > 0) {
        Toast.success(
          `Applied the view configuration of ${sourceDataset.name} to ${successCount} ${pluralize("dataset", successCount)}.`,
        );
      }
    },
  });
}
