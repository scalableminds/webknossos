import { getDataset, updateDatasetPartial } from "admin/rest_api";
import ColorGenerator from "libs/color_generator";
import { formatNumberToLength } from "libs/format_utils";
import { V3 } from "libs/mjs";
import isEqualWith from "lodash-es/isEqualWith";
import max from "lodash-es/max";
import mean from "lodash-es/mean";
import uniq from "lodash-es/uniq";
import { Matrix, SingularValueDecomposition } from "ml-matrix";
import type { APIDataset, CoordinateTransformation, VoxelSize } from "types/api_types";
import { LongUnitToShortUnitMap, type Vector3 } from "viewer/constants";
import { flatToNestedMatrix } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  createAffineTransform,
  getTransformPointUnscaledFn,
  type Transform,
} from "viewer/model/helpers/transformation_helpers";
import { MutableTreeMap } from "viewer/model/types/tree_types";

// The two layers of a layer registration: the moving layer gets transformed onto the fixed
// layer. The fixed layer is shown in the left view, the moving layer in the right view.
export type Side = "fixed" | "moving";
export const SIDES: Side[] = ["fixed", "moving"];
export const OTHER_SIDE: Record<Side, Side> = { fixed: "moving", moving: "fixed" };
export type LayerNames = Record<Side, string>;

// Each landmark is a tree with one node. The tree and node ids refer to the worker of the
// landmark's side. The pair id connects the two landmarks of a pair (see getLandmarkPairId).
// It is null if the tree name doesn't contain one.
export type Landmark = {
  pairId: number | null;
  treeId: number;
  nodeId: number;
  position: Vector3;
  color: Vector3;
};

export type LandmarkPair = {
  key: string;
  // Null for a landmark that can't be paired, see getLandmarkPairs.
  pairId: number | null;
  landmarks: Partial<Record<Side, Landmark>>;
  // Distance between the fixed landmark and the transformed moving landmark, see getLandmarkPairs
  // for the unit. A value that is much higher than in the other pairs usually means that this pair
  // was placed imprecisely. Null if no transform was estimated yet or if one of the landmarks is
  // missing.
  residual: number | null;
};

// The transform estimated from the current landmark pairs.
export type EstimatedTransform = {
  movingToFixedTransform: Transform;
  // See estimateMovingToFixedTransform.
  usedCopiesInNextSlice: boolean;
};

// Three pairs always lie in one plane, so they only work with the fallback in
// estimateMovingToFixedTransform.
export const MIN_LANDMARK_PAIR_COUNT = 3;
// If the smallest extent of a point cloud is below this fraction of its largest extent,
// the points are treated as lying in one plane (or on one line).
const MIN_EXTENT_RATIO = 1e-6;
// See isTransformAppliedToDataset.
const APPLIED_TRANSFORM_TOLERANCE = 1e-9;

// The two landmarks of a pair are trees with the same name, "Landmark <pair id>", one in each
// worker. A worker names a tree when a click creates it (see getNewLandmarkTreeProperties in
// layer_registration_worker.ts). Thus, a pair stays the same when other landmarks are deleted.
const LANDMARK_TREE_NAME_PATTERN = /^Landmark (\d+)$/;

export function getLandmarkTreeName(pairId: number): string {
  return `Landmark ${pairId}`;
}

export function getLandmarkPairId(treeName: string): number | null {
  const match = LANDMARK_TREE_NAME_PATTERN.exec(treeName);
  const pairId = match != null ? Number(match[1]) : 0;
  return pairId > 0 ? pairId : null;
}

// Both landmarks of a pair have this color.
export function getLandmarkColor(pairId: number): Vector3 {
  return ColorGenerator.distinctColorForId(pairId);
}

export function getLandmarks(trees: MutableTreeMap): Landmark[] {
  return Array.from(trees.values())
    .toSorted((a, b) => a.treeId - b.treeId)
    .flatMap((tree) =>
      Array.from(tree.nodes.values())
        .toSorted((a, b) => a.id - b.id)
        .map((node) => ({
          pairId: getLandmarkPairId(tree.name),
          treeId: tree.treeId,
          nodeId: node.id,
          position: node.untransformedPosition,
          color: tree.color,
        })),
    );
}

// Prepares the stored landmarks of one side for the import into its worker. Trees without
// nodes are left out: deleting the only node of a tree keeps the tree. Each tree gets the
// color of its pair. Trees without a pair id in their name (e.g. stored before pair ids
// existed) get new pair ids after the highest existing one, in the order of their tree ids.
export function prepareLandmarkTreesForImport(trees: MutableTreeMap): MutableTreeMap {
  const nonEmptyTrees = Array.from(trees.values())
    .filter((tree) => tree.nodes.size() > 0)
    .toSorted((a, b) => a.treeId - b.treeId);
  const existingPairIds = nonEmptyTrees.flatMap((tree) => getLandmarkPairId(tree.name) ?? []);
  let nextPairId = (max(existingPairIds) ?? 0) + 1;
  const preparedTrees = new MutableTreeMap();
  for (const tree of nonEmptyTrees) {
    const pairId = getLandmarkPairId(tree.name) ?? nextPairId++;
    preparedTrees.mutableSet(tree.treeId, {
      ...tree,
      name: getLandmarkTreeName(pairId),
      color: getLandmarkColor(pairId),
    });
  }
  return preparedTrees;
}

// Groups the landmarks of both sides into pairs by their pair id, sorted by pair id. A
// landmark without a pair id, or a second landmark with the same pair id on the same side,
// gets a row of its own with pair id null. Neither happens when the landmarks are placed in
// the workers.
// The landmark positions are in voxels. With the voxel size of the dataset, the residuals are
// lengths in the unit of the dataset, which also works for anisotropic voxels.
export function getLandmarkPairs(
  landmarks: Record<Side, Landmark[]>,
  movingToFixedTransform: Transform | null,
  voxelSizeFactor: Vector3 = [1, 1, 1],
): LandmarkPair[] {
  const transformPointMovingToFixed =
    movingToFixedTransform != null ? getTransformPointUnscaledFn(movingToFixedTransform) : null;
  const landmarksByPairId = new Map<number, Partial<Record<Side, Landmark>>>();
  const rowsWithoutPair: LandmarkPair[] = [];
  for (const side of SIDES) {
    for (const landmark of landmarks[side]) {
      const { pairId } = landmark;
      const pairLandmarks = pairId != null ? (landmarksByPairId.get(pairId) ?? {}) : null;
      if (pairId == null || pairLandmarks == null || pairLandmarks[side] != null) {
        rowsWithoutPair.push({
          key: `${side}-${landmark.nodeId}`,
          pairId: null,
          landmarks: { [side]: landmark },
          residual: null,
        });
        continue;
      }
      pairLandmarks[side] = landmark;
      landmarksByPairId.set(pairId, pairLandmarks);
    }
  }
  const pairs: LandmarkPair[] = Array.from(landmarksByPairId.entries())
    .toSorted(([firstPairId], [secondPairId]) => firstPairId - secondPairId)
    .map(([pairId, { fixed, moving }]) => ({
      key: String(pairId),
      pairId,
      landmarks: { fixed, moving },
      residual:
        transformPointMovingToFixed != null && fixed != null && moving != null
          ? V3.length(
              V3.scale3(
                V3.sub(fixed.position, transformPointMovingToFixed(moving.position)),
                voxelSizeFactor,
              ),
            )
          : null,
    }));
  return pairs.concat(rowsWithoutPair);
}

export type CompleteLandmarkPair = { pairId: number } & Record<Side, Landmark>;

// The pairs that have a landmark on both sides, sorted by pair id.
export function getCompleteLandmarkPairs(
  landmarks: Record<Side, Landmark[]>,
): CompleteLandmarkPair[] {
  return getLandmarkPairs(landmarks, null).flatMap(({ pairId, landmarks: { fixed, moving } }) =>
    pairId != null && fixed != null && moving != null ? [{ pairId, fixed, moving }] : [],
  );
}

// What a worker needs to know about the landmarks of the other worker to choose the pair id of
// its next landmark (see getNextLandmarkPairId). The layer registration page sends it after
// each sync.
export type LandmarkPairInfo = {
  // The pair ids that the other side has and this side doesn't, ascending.
  openPairIds: number[];
  // The highest pair id of the other side, or 0.
  otherMaxPairId: number;
};

function getPairIds(landmarks: Landmark[]): number[] {
  return landmarks.flatMap((landmark) => landmark.pairId ?? []);
}

export function getLandmarkPairInfo(
  landmarks: Record<Side, Landmark[]>,
  side: Side,
): LandmarkPairInfo {
  const ownPairIds = new Set(getPairIds(landmarks[side]));
  const otherPairIds = getPairIds(landmarks[OTHER_SIDE[side]]);
  return {
    openPairIds: uniq(otherPairIds.filter((pairId) => !ownPairIds.has(pairId))).toSorted(
      (a, b) => a - b,
    ),
    otherMaxPairId: max(otherPairIds) ?? 0,
  };
}

// A new landmark completes the pair with the lowest open pair id. If there is none, it starts
// a new pair. ownPairIds must be up to date. The pair info may be one sync old, which can only
// lead to a new pair instead of completing a pair that was opened during the last sync interval.
export function getNextLandmarkPairId(ownPairIds: Set<number>, pairInfo: LandmarkPairInfo): number {
  const openPairId = pairInfo.openPairIds.find((pairId) => !ownPairIds.has(pairId));
  if (openPairId != null) {
    return openPairId;
  }
  return Math.max(pairInfo.otherMaxPairId, max(Array.from(ownPairIds)) ?? 0) + 1;
}

// The residuals are lengths in the unit of the dataset (see getLandmarkPairs). Large values
// are shown in a larger unit, e.g. µm instead of nm.
export function formatResidual(residual: number, voxelSize: VoxelSize): string {
  return formatNumberToLength(residual, LongUnitToShortUnitMap[voxelSize.unit]);
}

// Null if no pair has a residual.
export function getMeanResidual(pairs: LandmarkPair[]): number | null {
  const residuals = pairs.flatMap((pair) => (pair.residual != null ? [pair.residual] : []));
  return residuals.length > 0 ? mean(residuals) : null;
}

// The affine estimation needs points that span all three dimensions. It doesn't reliably
// throw for points in one plane, but returns a matrix with huge values instead.
function spansThreeDimensions(positions: Vector3[]): boolean {
  const center = V3.scale(
    positions.reduce((sum, position) => V3.add(sum, position)),
    1 / positions.length,
  );
  const centeredPositions = new Matrix(positions.map((position) => V3.sub(position, center)));
  // The singular values are sorted descending. They measure the extent of the centered
  // points along their three main directions.
  const [largestExtent, , smallestExtent] = new SingularValueDecomposition(centeredPositions, {
    computeLeftSingularVectors: false,
    computeRightSingularVectors: false,
  }).diagonal;
  return smallestExtent > largestExtent * MIN_EXTENT_RATIO;
}

function canEstimateTransform(sourcePositions: Vector3[], targetPositions: Vector3[]) {
  return spansThreeDimensions(sourcePositions) && spansThreeDimensions(targetPositions);
}

function addCopiesInNextSlice(positions: Vector3[]): Vector3[] {
  return positions.concat(positions.map(([x, y, z]): Vector3 => [x, y, z + 1]));
}

// If all landmarks lie in one plane (usually because they were placed in a single z
// slice), no 3D transform can be estimated from them. Then, each landmark is copied to
// the next slice (z + 1) on both sides and the transform is estimated from the landmarks
// and their copies. This assumes that one z slice of the moving layer corresponds to one z
// slice of the fixed layer. The dataset composition wizard uses the same fallback. The copies
// only exist here and are never added to an annotation.
export function estimateMovingToFixedTransform(
  landmarks: Record<Side, Landmark[]>,
): { transform: Transform; usedCopiesInNextSlice: boolean } | { errorMessage: string } {
  // Landmarks without a partner are left out.
  const pairs = getCompleteLandmarkPairs(landmarks);
  if (pairs.length < MIN_LANDMARK_PAIR_COUNT) {
    return {
      errorMessage: `Need at least ${MIN_LANDMARK_PAIR_COUNT} landmark pairs (a landmark in both views) to estimate a transform.`,
    };
  }
  const fixedPositions = pairs.map((pair) => pair.fixed.position);
  const movingPositions = pairs.map((pair) => pair.moving.position);
  if (canEstimateTransform(movingPositions, fixedPositions)) {
    return {
      transform: createAffineTransform(movingPositions, fixedPositions),
      usedCopiesInNextSlice: false,
    };
  }

  const extendedFixedPositions = addCopiesInNextSlice(fixedPositions);
  const extendedMovingPositions = addCopiesInNextSlice(movingPositions);
  if (canEstimateTransform(extendedMovingPositions, extendedFixedPositions)) {
    return {
      transform: createAffineTransform(extendedMovingPositions, extendedFixedPositions),
      usedCopiesInNextSlice: true,
    };
  }
  return {
    errorMessage:
      "The landmarks don't allow estimating a transform, e.g. because they all lie on one line. Spread them out more.",
  };
}

// The tree group that holds the landmarks of one side of a layer pair in the layer
// registration annotation. Each moving layer has a group with one subgroup per side:
// "color_2" > "color_1 landmarks" (fixed layer) and "color_2" > "color_2 landmarks".
export function getLandmarkGroupPath(layerNames: LayerNames, side: Side): string[] {
  return [layerNames.moving, `${layerNames[side]} landmarks`];
}

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

// The transform of one moving layer as estimated from its landmarks.
export type LayerPairTransformEstimate = {
  landmarks: Record<Side, Landmark[]>;
  estimation: ReturnType<typeof estimateMovingToFixedTransform>;
  completePairCount: number;
  // See getMeanResidual. Null if no transform could be estimated.
  meanResidual: number | null;
};

export function getLayerPairTransformEstimate(
  landmarks: Record<Side, Landmark[]>,
  voxelSizeFactor: Vector3,
): LayerPairTransformEstimate {
  const estimation = estimateMovingToFixedTransform(landmarks);
  const movingToFixedTransform = "transform" in estimation ? estimation.transform : null;
  return {
    landmarks,
    estimation,
    completePairCount: getCompleteLandmarkPairs(landmarks).length,
    meanResidual: getMeanResidual(
      getLandmarkPairs(landmarks, movingToFixedTransform, voxelSizeFactor),
    ),
  };
}

// Whether the dataset uses the estimated transform of a moving layer: "notEnoughPairs" if no
// transform could be estimated from the landmarks.
export type AppliedState = "applied" | "notApplied" | "notEnoughPairs";

export function getAppliedState(
  estimation: LayerPairTransformEstimate["estimation"],
  fixedLayerTransforms: CoordinateTransformation[] | null | undefined,
  movingLayerTransforms: CoordinateTransformation[] | null | undefined,
): AppliedState {
  if (!("transform" in estimation)) {
    return "notEnoughPairs";
  }
  return isTransformAppliedToDataset(
    estimation.transform,
    fixedLayerTransforms,
    movingLayerTransforms,
  )
    ? "applied"
    : "notApplied";
}

const FIXED_LAYER_OVERLAY_COLOR: Vector3 = [0, 255, 0];
const MOVING_LAYER_OVERLAY_COLOR: Vector3 = [255, 0, 255];

// The colors of the two layers while a worker shows both: the fixed layer in green and the
// moving layer in magenta, as in BigWarp. Where the layers match, they add up to gray, and
// structures that don't match show colored edges. Null unless both are color layers, because
// segmentation layers have no layer color.
export function getOverlayLayerColors(
  dataset: APIDataset,
  layerNames: LayerNames,
): Record<string, Vector3> | null {
  const areColorLayers = SIDES.every(
    (side) =>
      dataset.dataSource.dataLayers.find((layer) => layer.name === layerNames[side])?.category ===
      "color",
  );
  return areColorLayers
    ? {
        [layerNames.fixed]: FIXED_LAYER_OVERLAY_COLOR,
        [layerNames.moving]: MOVING_LAYER_OVERLAY_COLOR,
      }
    : null;
}

type DataLayers = APIDataset["dataSource"]["dataLayers"];

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
// dataset (see applyTransformsToDataset).
function getAppliedMovingLayerTransforms(
  movingToFixedTransform: Transform,
  fixedLayerTransforms: CoordinateTransformation[] | null | undefined,
): CoordinateTransformation[] {
  return [
    { type: "affine", matrix: flatToNestedMatrix(movingToFixedTransform.affineMatrix) },
    ...(fixedLayerTransforms ?? []),
  ];
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
