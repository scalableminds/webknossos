import type { APIDataset } from "types/api_types";
import {
  type AppliedState,
  getAppliedState,
  type LayerTransformsInDataset,
} from "./layer_registration_dataset_transforms";
import type { LayerPairTransformEstimate } from "./layer_registration_transform_estimation";

// The layers that can be registered to the fixed layer, in the order of the dataset.
export function getMovingLayerNames(dataset: APIDataset, fixedLayerName: string): string[] {
  return dataset.dataSource.dataLayers
    .map((layer) => layer.name)
    .filter((name) => name !== fixedLayerName);
}

// The requested moving layer if it exists, otherwise the first moving layer.
export function getActiveMovingLayerName(
  movingLayerNames: string[],
  requestedLayerName: string | null,
): string | null {
  return requestedLayerName != null && movingLayerNames.includes(requestedLayerName)
    ? requestedLayerName
    : (movingLayerNames[0] ?? null);
}

// A moving layer that is not shown in the right view.
export type InactivePair = {
  estimate: LayerPairTransformEstimate;
  // The stored landmarks of the fixed layer side, to copy them to the active pair. Null if
  // there are none.
  fixedSideNmlString: string | null;
};

// Null while loading. The map has no entry for a layer whose landmarks could not be read.
export type InactivePairs = Map<string, InactivePair> | null;

// The state of the estimated transform of one moving layer. The counts only exist once its
// landmarks are loaded.
export type MovingLayerRow = { layerName: string } & (
  | {
      status: "loaded";
      completePairCount: number;
      meanResidual: number | null;
      appliedState: AppliedState;
    }
  | { status: "loading" }
  | { status: "failed" }
);

export function getMovingLayerRows({
  movingLayerNames,
  activeLayerName,
  activePairEstimate,
  inactivePairs,
  fixedLayerName,
  layerTransformsInDataset,
}: {
  movingLayerNames: string[];
  activeLayerName: string;
  activePairEstimate: LayerPairTransformEstimate;
  inactivePairs: InactivePairs;
  fixedLayerName: string;
  layerTransformsInDataset: LayerTransformsInDataset;
}): MovingLayerRow[] {
  return movingLayerNames.map((layerName) => {
    const pairEstimate =
      layerName === activeLayerName ? activePairEstimate : inactivePairs?.get(layerName)?.estimate;
    if (pairEstimate == null) {
      return inactivePairs == null
        ? { layerName, status: "loading" }
        : { layerName, status: "failed" };
    }
    return {
      layerName,
      status: "loaded",
      completePairCount: pairEstimate.completePairCount,
      meanResidual: pairEstimate.meanResidual,
      appliedState: getAppliedState(
        pairEstimate.estimation,
        layerTransformsInDataset[fixedLayerName],
        layerTransformsInDataset[layerName],
      ),
    };
  });
}

// A moving layer whose fixed layer landmarks can be copied to the active moving layer.
export type CopySource = { layerName: string; landmarkCount: number };

// The inactive pairs that have fixed layer landmarks, the ones with the most landmarks first.
export function getCopySources(inactivePairs: InactivePairs): CopySource[] {
  return Array.from(inactivePairs ?? [])
    .flatMap(([layerName, pair]) =>
      pair.fixedSideNmlString != null
        ? [{ layerName, landmarkCount: pair.estimate.landmarks.fixed.length }]
        : [],
    )
    .toSorted((a, b) => b.landmarkCount - a.landmarkCount);
}
