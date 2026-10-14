import type { Transform } from "viewer/model/helpers/transformation_helpers";
import {
  getAppliedState,
  type LayerTransformsInDataset,
} from "./layer_registration_dataset_transforms";
import type { TransformEstimation } from "./layer_registration_transform_estimation";

// The transform estimation of each moving layer. Undefined for a layer whose landmarks could
// not be read.
export type EstimationsByMovingLayer = Map<string, TransformEstimation | undefined>;

// The transforms of the moving layers that have enough landmark pairs.
export function getTransformsToApply(
  estimations: EstimationsByMovingLayer,
): Map<string, Transform> {
  const transformsByMovingLayer = new Map<string, Transform>();
  for (const [layerName, estimation] of estimations) {
    if (estimation != null && !("errorMessage" in estimation)) {
      transformsByMovingLayer.set(layerName, estimation.movingToFixedTransform);
    }
  }
  return transformsByMovingLayer;
}

function getChangeDescription(
  estimation: TransformEstimation | undefined,
  fixedLayerTransforms: LayerTransformsInDataset[string],
  movingLayerTransforms: LayerTransformsInDataset[string],
): string {
  if (estimation == null || "errorMessage" in estimation) {
    return "stays unchanged (not enough landmark pairs)";
  }
  return getAppliedState(estimation, fixedLayerTransforms, movingLayerTransforms) === "applied"
    ? "already uses its transform"
    : "gets its new transform";
}

// The content of the dialog that confirms applying the transforms: what happens to each moving
// layer, and what applying replaces.
export function ApplyTransformsDialogContent({
  estimations,
  fixedLayerName,
  layerTransformsInDataset,
}: {
  estimations: EstimationsByMovingLayer;
  fixedLayerName: string;
  layerTransformsInDataset: LayerTransformsInDataset;
}) {
  const fixedLayerTransforms = layerTransformsInDataset[fixedLayerName];
  return (
    <>
      <ul>
        {Array.from(estimations, ([layerName, estimation]) => (
          <li key={layerName}>
            "{layerName}"{" "}
            {getChangeDescription(
              estimation,
              fixedLayerTransforms,
              layerTransformsInDataset[layerName],
            )}
          </li>
        ))}
      </ul>
      <p>Applying replaces the transforms that a layer currently has in the dataset.</p>
      {(fixedLayerTransforms ?? []).length > 0 ? (
        <p>
          "{fixedLayerName}" has transforms itself. The applied transforms build on them, so
          changing the transforms of "{fixedLayerName}" later makes them outdated.
        </p>
      ) : null}
    </>
  );
}
