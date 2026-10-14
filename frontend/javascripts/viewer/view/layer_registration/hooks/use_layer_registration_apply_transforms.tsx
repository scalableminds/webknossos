import { App } from "antd";
import { handleGenericError } from "libs/error_handling";
import Toast from "libs/toast";
import { useState } from "react";
import type { APIDataset } from "types/api_types";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import type { Transform } from "viewer/model/helpers/transformation_helpers";
import {
  ApplyTransformsDialogContent,
  type EstimationsByMovingLayer,
  getTransformsToApply,
} from "../layer_registration_apply_transforms_dialog";
import {
  applyTransformsToDataset,
  getLayerTransformsInDataset,
} from "../layer_registration_dataset_transforms";
import type { Landmark, Side } from "../layer_registration_helpers";
import type { InactivePairs } from "../layer_registration_moving_layers";
import { estimateMovingToFixedTransform } from "../layer_registration_transform_estimation";

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
