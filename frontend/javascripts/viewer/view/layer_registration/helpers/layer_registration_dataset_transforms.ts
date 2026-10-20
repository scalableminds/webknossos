import { getDataset, updateDatasetPartial } from "admin/rest_api";
import isEqualWith from "lodash-es/isEqualWith";
import type { APIDataset, CoordinateTransformation } from "types/api_types";
import { flatToNestedMatrix } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import type { Transform } from "viewer/model/helpers/transformation_helpers";
import type { TransformEstimation } from "./layer_registration_transform_estimation";

// See isTransformAppliedToDataset.
const APPLIED_TRANSFORM_TOLERANCE = 1e-9;

type DataLayers = APIDataset["dataSource"]["dataLayers"];

// The transforms that the dataset stores for each of its layers, by layer name.
export type LayerTransformsInDataset = Record<
  string,
  CoordinateTransformation[] | null | undefined
>;

export function getLayerTransformsInDataset(dataLayers: DataLayers): LayerTransformsInDataset {
  return Object.fromEntries(
    dataLayers.map((layer) => [layer.name, layer.coordinateTransformations]),
  );
}

// The transforms that the moving layer gets when its estimated transform is applied to the
// dataset: its transform, followed by the transforms of the fixed layer.
function getAppliedMovingLayerTransforms(
  movingToFixedTransform: Transform,
  fixedLayerTransforms: CoordinateTransformation[] | null | undefined,
): CoordinateTransformation[] {
  return [
    { type: "affine", matrix: flatToNestedMatrix(movingToFixedTransform.affineMatrix) },
    ...(fixedLayerTransforms ?? []),
  ];
}

// The data layers after applying the estimated transforms. Each transform maps the untransformed
// coordinates of its moving layer to the untransformed coordinates of the fixed layer. So a
// moving layer gets its transform, followed by the transforms of the fixed layer. Its previous
// transforms are replaced. Layers that are not in the map stay unchanged.
export function getDataLayersWithAppliedTransforms(
  dataLayers: DataLayers,
  fixedLayerName: string,
  transformsByMovingLayer: Map<string, Transform>,
): DataLayers {
  const fixedLayer = dataLayers.find((layer) => layer.name === fixedLayerName);
  const missingLayerNames = [fixedLayerName, ...transformsByMovingLayer.keys()].filter(
    (name) => !dataLayers.some((layer) => layer.name === name),
  );
  if (fixedLayer == null || missingLayerNames.length > 0) {
    throw new Error(
      `The dataset has no layer named ${missingLayerNames.map((name) => `"${name}"`).join(" or ")} anymore.`,
    );
  }
  return dataLayers.map((layer) => {
    const transform = transformsByMovingLayer.get(layer.name);
    return transform != null
      ? {
          ...layer,
          coordinateTransformations: getAppliedMovingLayerTransforms(
            transform,
            fixedLayer.coordinateTransformations,
          ),
        }
      : layer;
  });
}

// Applies the estimated transforms of the moving layers to the dataset (see
// getDataLayersWithAppliedTransforms).
// Returns the transforms of all layers of the dataset afterwards.
export async function applyTransformsToDataset(
  datasetId: string,
  fixedLayerName: string,
  transformsByMovingLayer: Map<string, Transform>,
): Promise<LayerTransformsInDataset> {
  const dataset = await getDataset(datasetId);
  if (!dataset.isActive) {
    throw new Error("The dataset is not active anymore.");
  }
  const dataLayers = getDataLayersWithAppliedTransforms(
    dataset.dataSource.dataLayers,
    fixedLayerName,
    transformsByMovingLayer,
  );
  await updateDatasetPartial(datasetId, {
    dataSource: { ...dataset.dataSource, dataLayers },
  });
  return getLayerTransformsInDataset(dataLayers);
}

// Whether the moving layer has exactly the transforms that applying the estimated transform
// would give it. The numbers are compared with a small tolerance, because the server may store
// them with less precision.
export function isTransformAppliedToDataset(
  movingToFixedTransform: Transform,
  fixedLayerTransforms: CoordinateTransformation[] | null | undefined,
  movingLayerTransforms: CoordinateTransformation[] | null | undefined,
): boolean {
  return isEqualWith(
    getAppliedMovingLayerTransforms(movingToFixedTransform, fixedLayerTransforms),
    movingLayerTransforms ?? [],
    (a, b) =>
      typeof a === "number" && typeof b === "number"
        ? Math.abs(a - b) <= APPLIED_TRANSFORM_TOLERANCE * Math.max(1, Math.abs(a))
        : undefined,
  );
}

// Whether the dataset uses the estimated transform of a moving layer. "transformEstimationFailed"
// if no transform could be estimated from the landmarks, e.g. because there are too few pairs.
export type AppliedState = "applied" | "notApplied" | "transformEstimationFailed";

export function getAppliedState(
  estimation: TransformEstimation,
  fixedLayerTransforms: CoordinateTransformation[] | null | undefined,
  movingLayerTransforms: CoordinateTransformation[] | null | undefined,
): AppliedState {
  if ("errorMessage" in estimation) {
    return "transformEstimationFailed";
  }
  return isTransformAppliedToDataset(
    estimation.movingToFixedTransform,
    fixedLayerTransforms,
    movingLayerTransforms,
  )
    ? "applied"
    : "notApplied";
}
