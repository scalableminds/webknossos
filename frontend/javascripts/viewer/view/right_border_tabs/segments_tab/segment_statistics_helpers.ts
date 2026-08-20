import { EigenvalueDecomposition, Matrix } from "ml-matrix";
import type {
  SegmentCovarianceMatrix,
  SegmentStatisticsFileInfo,
  SegmentStatisticsMetric,
  VoxelSize,
} from "types/api_types";
import type { Vector3 } from "viewer/constants";

export type AvailableFileMetrics = {
  maxDistance: boolean;
  sphericity: boolean;
  centerOfMass: boolean;
  covariance: boolean;
  // Unlike the four above, these two also have non-file sources, so a false here does not mean the
  // statistic is unavailable – only that this file cannot serve it.
  volume: boolean;
  surfaceArea: boolean;
};

const NO_METRICS: AvailableFileMetrics = {
  maxDistance: false,
  sphericity: false,
  centerOfMass: false,
  covariance: false,
  volume: false,
  surfaceArea: false,
};

/**
 * Decides which of the statistics-file-backed metrics may be requested for the currently active
 * mapping. This mirrors the backend's `checkMagAndMappingNameMatch`: max distance and sphericity
 * require the file's mapping to match exactly, while center of mass and covariance matrix can also
 * be served for a different mapping by recombining oversegmentation values – but only if the file
 * itself was computed without a mapping, and only if the arrays needed for that recombination are
 * present.
 *
 * Volume and surface area follow the same rules but are reported separately, because the backend can
 * also serve them without a file — callers have to combine these flags with the other sources.
 *
 * The mag is deliberately not checked here: callers request the file's own mag, which the backend
 * always accepts.
 */
export function getAvailableFileMetrics(
  fileInfo: SegmentStatisticsFileInfo | null | undefined,
  activeMappingName: string | null | undefined,
): AvailableFileMetrics {
  if (fileInfo == null) {
    return NO_METRICS;
  }
  // The backend omits mappingName entirely when the file has none, and normalizes "" to absent.
  const fileMappingName = fileInfo.mappingName || null;
  const mappingMatches = fileMappingName === (activeMappingName || null);
  // A file without its own mapping holds the oversegmentation, so its values can be combined into
  // the segments of any mapping.
  const canRecombine = fileMappingName == null;
  const has = (metric: SegmentStatisticsMetric) => fileInfo.availableMetrics.includes(metric);

  return {
    maxDistance: has("max_distances") && mappingMatches,
    sphericity: has("sphericities") && mappingMatches,
    centerOfMass: has("center_of_mass") && (mappingMatches || (canRecombine && has("volumes"))),
    covariance:
      has("covariance_matrix") &&
      (mappingMatches || (canRecombine && has("volumes") && has("center_of_mass"))),
    volume: has("volumes") && (mappingMatches || canRecombine),
    surfaceArea: has("surfaces") && mappingMatches,
  };
}

/**
 * Turns a segment's covariance matrix into the standard deviations along its three principal axes,
 * sorted descending. Together they describe the ellipsoid that best fits the segment, which is far
 * more readable than nine raw matrix entries.
 *
 * The matrix comes in squared mag1 voxels, so it is first transformed into physical space via
 * `S·C·Sᵀ` with `S = diag(voxelSize.factor)` – a plain per-axis multiplication would be wrong for
 * anisotropic voxels because the off-diagonal entries mix two axes. The result is in
 * `voxelSize.unit`.
 */
export function covarianceMatrixToPrincipalExtents(
  covarianceInMag1Vx: SegmentCovarianceMatrix,
  voxelSize: VoxelSize,
): Vector3 {
  const factor = voxelSize.factor;
  const covarianceInUnit2 = covarianceInMag1Vx.map((row, i) =>
    row.map((value, j) => value * factor[i] * factor[j]),
  );

  const eigenvalues = new EigenvalueDecomposition(new Matrix(covarianceInUnit2)).realEigenvalues
    // A covariance matrix is positive semi-definite, so negative eigenvalues can only come from
    // floating point error and are clamped away before taking the square root.
    .map((eigenvalue) => Math.sqrt(Math.max(eigenvalue, 0)));

  const [first, second, third] = eigenvalues.sort((a, b) => b - a);
  return [first, second, third];
}
