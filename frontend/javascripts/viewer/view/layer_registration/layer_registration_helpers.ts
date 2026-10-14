import ColorGenerator from "libs/color_generator";
import { formatNumberToLength } from "libs/format_utils";
import { V3 } from "libs/mjs";
import max from "lodash-es/max";
import mean from "lodash-es/mean";
import uniq from "lodash-es/uniq";
import type { APIDataset, VoxelSize } from "types/api_types";
import { LongUnitToShortUnitMap, type Vector3 } from "viewer/constants";
import {
  getTransformPointUnscaledFn,
  type Transform,
} from "viewer/model/helpers/transformation_helpers";
import { MutableTreeMap } from "viewer/model/types/tree_types";

// The two layers of a layer registration: the moving layer gets transformed onto the fixed
// layer. The fixed layer is shown in the left view, the moving layer in the right view.
export type Side = "fixed" | "moving";
export const SIDES: Side[] = ["fixed", "moving"];
export const OTHER_SIDE: Record<Side, Side> = { fixed: "moving", moving: "fixed" };
export const VIEW_NAMES: Record<Side, string> = { fixed: "left", moving: "right" };
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

export type CompleteLandmarkPair = { pairId: number } & Record<Side, Landmark>;

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
          ? getResidual(
              fixed.position,
              transformPointMovingToFixed(moving.position),
              voxelSizeFactor,
            )
          : null,
    }));
  return pairs.concat(rowsWithoutPair);
}

// The pairs that have a landmark on both sides, sorted by pair id.
export function getCompleteLandmarkPairs(
  landmarks: Record<Side, Landmark[]>,
): CompleteLandmarkPair[] {
  return getLandmarkPairs(landmarks, null).flatMap(({ pairId, landmarks: { fixed, moving } }) =>
    pairId != null && fixed != null && moving != null ? [{ pairId, fixed, moving }] : [],
  );
}

export function isCompletePair(pair: LandmarkPair): boolean {
  return pair.pairId != null && pair.landmarks.fixed != null && pair.landmarks.moving != null;
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

// Residuals below this fraction of the voxel size are floating point noise, e.g. when the
// landmarks fit exactly.
const RESIDUAL_NOISE_FACTOR = 1e-6;
// A pair whose error is this many times higher than the mean error is highlighted, because it
// was probably placed imprecisely.
const HIGH_RESIDUAL_FACTOR = 2;

// Floating point noise is returned as 0. Otherwise, it would be formatted in tiny units (e.g.
// "185 ym") and fill the error bars.
function getResidual(
  fixedPosition: Vector3,
  transformedMovingPosition: Vector3,
  voxelSizeFactor: Vector3,
): number {
  const residual = V3.length(
    V3.scale3(V3.sub(fixedPosition, transformedMovingPosition), voxelSizeFactor),
  );
  return residual < RESIDUAL_NOISE_FACTOR * Math.min(...voxelSizeFactor) ? 0 : residual;
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

// Errors below the size of one voxel are never high: if the landmarks fit exactly, all errors
// are just floating point noise.
export function isHighResidual(
  residual: number,
  meanResidual: number | null,
  voxelSizeFactor: Vector3,
): boolean {
  return (
    meanResidual != null &&
    residual > Math.max(HIGH_RESIDUAL_FACTOR * meanResidual, Math.min(...voxelSizeFactor))
  );
}

// The tree group that holds the landmarks of one side of a layer pair in the layer
// registration annotation. Each moving layer has a group with one subgroup per side:
// "color_2" > "color_1 landmarks" (fixed layer) and "color_2" > "color_2 landmarks".
export function getLandmarkGroupPath(layerNames: LayerNames, side: Side): string[] {
  return [layerNames.moving, `${layerNames[side]} landmarks`];
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
