import { getDataset, updateDatasetPartial } from "admin/rest_api";
import { V3 } from "libs/mjs";
import mean from "lodash-es/mean";
import zip from "lodash-es/zip";
import { Matrix, SingularValueDecomposition } from "ml-matrix";
import type { APIDataset } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { flatToNestedMatrix } from "viewer/model/accessors/dataset_layer_transformation_accessor";
import {
  createAffineTransform,
  getTransformPointUnscaledFn,
  type Transform,
} from "viewer/model/helpers/transformation_helpers";
import type { MutableTreeMap } from "viewer/model/types/tree_types";

// "A" is the fixed layer, "B" is the moving layer that gets transformed onto A.
export type Side = "A" | "B";
export const SIDES: Side[] = ["A", "B"];
export const OTHER_SIDE: Record<Side, Side> = { A: "B", B: "A" };
export type LayerNames = Record<Side, string>;

export type Landmark = { position: Vector3; color: Vector3 };

export type LandmarkPair = {
  key: number;
  landmarks: Partial<Record<Side, Landmark>>;
  // Distance between landmark A and the transformed landmark B. A value that is much
  // higher than in the other pairs usually means that this pair was placed imprecisely.
  // Null if no transform was estimated yet or if one of the landmarks is missing.
  residual: number | null;
};

// The transform that is shown in the workers, and what it was computed from.
export type Alignment = {
  transformBtoA: Transform;
  landmarks: Record<Side, Landmark[]>;
  // See estimateTransformBtoA.
  usedCopiesInNextSlice: boolean;
};

// Three pairs always lie in one plane, so they only work with the fallback in
// estimateTransformBtoA.
export const MIN_LANDMARK_PAIR_COUNT = 3;
// If the smallest extent of a point cloud is below this fraction of its largest extent,
// the points are treated as lying in one plane (or on one line).
const MIN_EXTENT_RATIO = 1e-6;

// Each node is one landmark. Landmarks are paired by their order: the n-th landmark of
// one side belongs to the n-th landmark of the other side. The order is given by the
// tree ids and, within a tree, by the node ids.
export function getLandmarks(trees: MutableTreeMap): Landmark[] {
  return Array.from(trees.values())
    .toSorted((a, b) => a.treeId - b.treeId)
    .flatMap((tree) =>
      Array.from(tree.nodes.values())
        .toSorted((a, b) => a.id - b.id)
        .map((node) => ({ position: node.untransformedPosition, color: tree.color })),
    );
}

export function getLandmarkPairs(
  landmarks: Record<Side, Landmark[]>,
  transformBtoA: Transform | null,
): LandmarkPair[] {
  const transformPointBtoA =
    transformBtoA != null ? getTransformPointUnscaledFn(transformBtoA) : null;
  return zip(landmarks.A, landmarks.B).map(([landmarkA, landmarkB], index) => ({
    key: index,
    landmarks: { A: landmarkA, B: landmarkB },
    residual:
      transformPointBtoA != null && landmarkA != null && landmarkB != null
        ? V3.length(V3.sub(landmarkA.position, transformPointBtoA(landmarkB.position)))
        : null,
  }));
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
// and their copies. This assumes that one z slice of layer B corresponds to one z slice of
// layer A. The dataset composition wizard uses the same fallback. The copies only exist
// here and are never added to an annotation.
export function estimateTransformBtoA(
  landmarks: Record<Side, Landmark[]>,
): { transform: Transform; usedCopiesInNextSlice: boolean } | { errorMessage: string } {
  if (landmarks.A.length < MIN_LANDMARK_PAIR_COUNT || landmarks.A.length !== landmarks.B.length) {
    return {
      errorMessage: `Need at least ${MIN_LANDMARK_PAIR_COUNT} matching landmark pairs (the same number on both sides) before aligning.`,
    };
  }
  const positionsA = landmarks.A.map((landmark) => landmark.position);
  const positionsB = landmarks.B.map((landmark) => landmark.position);
  if (canEstimateTransform(positionsB, positionsA)) {
    return {
      transform: createAffineTransform(positionsB, positionsA),
      usedCopiesInNextSlice: false,
    };
  }

  const extendedPositionsA = addCopiesInNextSlice(positionsA);
  const extendedPositionsB = addCopiesInNextSlice(positionsB);
  if (canEstimateTransform(extendedPositionsB, extendedPositionsA)) {
    return {
      transform: createAffineTransform(extendedPositionsB, extendedPositionsA),
      usedCopiesInNextSlice: true,
    };
  }
  return {
    errorMessage:
      "The landmarks don't allow estimating a transform, e.g. because they all lie on one line. Spread them out more.",
  };
}

export function getLandmarkGroupPath(layerNames: LayerNames, side: Side): string[] {
  return [`Layer pair: ${layerNames.A} × ${layerNames.B}`, `${layerNames[side]} landmarks`];
}

// The layers of the alignment that don't exist in the dataset (anymore), e.g. because they
// were renamed.
export function getMissingLayerNames(dataset: APIDataset, layerNames: LayerNames): string[] {
  const datasetLayerNames = new Set(dataset.dataSource.dataLayers.map((layer) => layer.name));
  return SIDES.map((side) => layerNames[side]).filter((name) => !datasetLayerNames.has(name));
}

// Stores the alignment in the dataset. The transform maps the untransformed coordinates
// of layer B to the untransformed coordinates of layer A. So layer B gets this transform,
// followed by the transforms of layer A. Its previous transforms are replaced.
export async function storeAlignmentInDataset(
  datasetId: string,
  layerNames: LayerNames,
  transformBtoA: Transform,
): Promise<void> {
  const dataset = await getDataset(datasetId);
  if (!dataset.isActive) {
    throw new Error("The dataset is not active anymore.");
  }
  const { dataLayers } = dataset.dataSource;
  const layerA = dataLayers.find((layer) => layer.name === layerNames.A);
  const layerB = dataLayers.find((layer) => layer.name === layerNames.B);
  if (layerA == null || layerB == null) {
    throw new Error("The layers to align don't exist in the dataset anymore.");
  }
  const coordinateTransformations = [
    { type: "affine" as const, matrix: flatToNestedMatrix(transformBtoA.affineMatrix) },
    ...(layerA.coordinateTransformations ?? []),
  ];
  await updateDatasetPartial(datasetId, {
    dataSource: {
      ...dataset.dataSource,
      dataLayers: dataLayers.map((layer) =>
        layer === layerB ? { ...layer, coordinateTransformations } : layer,
      ),
    },
  });
}
