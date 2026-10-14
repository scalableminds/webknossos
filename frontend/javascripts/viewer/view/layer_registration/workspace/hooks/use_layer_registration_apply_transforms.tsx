import { App } from "antd";
import { handleGenericError } from "libs/error_handling";
import Toast from "libs/toast";
import { useState } from "react";
import type { APIDataset } from "types/api_types";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import type { Transform } from "viewer/model/helpers/transformation_helpers";
import {
  applyTransformsToDataset,
  getAppliedState,
  getLayerTransformsInDataset,
  type LayerTransformsInDataset,
} from "../../helpers/layer_registration_dataset_transforms";
import type { Landmark, Side } from "../../helpers/layer_registration_helpers";
import type { InactivePairs } from "../../helpers/layer_registration_moving_layers";
import {
  estimateMovingToFixedTransform,
  type TransformEstimation,
} from "../../helpers/layer_registration_transform_estimation";

// The transform estimation of each moving layer. Undefined for a layer whose landmarks could
// not be read.
type EstimationsByMovingLayer = Map<string, TransformEstimation | undefined>;

// The transforms of the moving layers that have enough landmark pairs.
function getTransformsToApply(estimations: EstimationsByMovingLayer): Map<string, Transform> {
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
function ApplyTransformsDialogContent({
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

// Longer than usual, so that there is time to click the link in the toast.
const APPLIED_TOAST_TIMEOUT_MS = 15_000;

function showAppliedToast(dataset: APIDataset) {
  Toast.success(
    <>
      Applied the transforms to the dataset.{" "}
      <a href={getViewDatasetURL(dataset)} target="_blank" rel="noopener noreferrer">
        Open the dataset
      </a>{" "}
      to see the result.
    </>,
    { timeout: APPLIED_TOAST_TIMEOUT_MS },
  );
}

/** Applies the estimated transforms of all moving layers that have enough landmark pairs to the
 * dataset, after a confirmation. The synced landmarks may miss a landmark that was placed right
 * before, so the transform of the active moving layer is estimated again from the current
 * landmarks of the workers.
 * Also returns the transforms that the dataset stores for its layers, which are updated after
 * applying.
 */
export function useApplyTransforms({
  dataset,
  fixedLayerName,
  movingLayerNames,
  activeLayerName,
  inactivePairs,
  fetchLandmarks,
}: {
  dataset: APIDataset;
  fixedLayerName: string;
  movingLayerNames: string[];
  activeLayerName: string;
  inactivePairs: InactivePairs;
  // Reads the current landmarks of the workers.
  fetchLandmarks: () => Promise<Record<Side, Landmark[]>>;
}) {
  const { modal } = App.useApp();
  const [layerTransformsInDataset, setLayerTransformsInDataset] = useState(() =>
    getLayerTransformsInDataset(dataset.dataSource.dataLayers),
  );

  const applyAndNotify = async (transformsByMovingLayer: Map<string, Transform>) => {
    try {
      setLayerTransformsInDataset(
        await applyTransformsToDataset(dataset.id, fixedLayerName, transformsByMovingLayer),
      );
      showAppliedToast(dataset);
    } catch (error) {
      handleGenericError(error as Error, "Could not apply the transforms to the dataset.");
    }
  };

  const applyTransforms = async () => {
    if (inactivePairs == null) {
      Toast.info("The landmarks of the other layers are still loading. Please try again.");
      return;
    }
    let currentLandmarks: Record<Side, Landmark[]>;
    try {
      currentLandmarks = await fetchLandmarks();
    } catch (error) {
      handleGenericError(error as Error, "Could not read the landmarks of the views.");
      return;
    }
    const estimations: EstimationsByMovingLayer = new Map(
      movingLayerNames.map((layerName) => [
        layerName,
        layerName === activeLayerName
          ? estimateMovingToFixedTransform(currentLandmarks)
          : inactivePairs.get(layerName)?.estimate.estimation,
      ]),
    );
    const transformsByMovingLayer = getTransformsToApply(estimations);
    if (transformsByMovingLayer.size === 0) {
      Toast.warning("No layer has enough landmark pairs for a transform yet.");
      return;
    }
    modal.confirm({
      title: "Apply the estimated transforms to the dataset?",
      okText: "Apply",
      content: (
        <ApplyTransformsDialogContent
          estimations={estimations}
          fixedLayerName={fixedLayerName}
          layerTransformsInDataset={layerTransformsInDataset}
        />
      ),
      onOk: () => applyAndNotify(transformsByMovingLayer),
    });
  };

  return { layerTransformsInDataset, applyTransforms };
}
