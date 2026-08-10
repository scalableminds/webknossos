import { Matrix } from "ml-matrix";
import { Euler, Matrix4 } from "three";
import type {
  SegmentCovarianceMatrix,
  SegmentStatisticsFileInfo,
  SegmentStatisticsMetric,
  VoxelSize,
} from "types/api_types";
import { UnitLong, type Vector3 } from "viewer/constants";
import {
  covarianceMatrixToPrincipalExtents,
  getAvailableFileMetrics,
} from "viewer/view/right_border_tabs/segments_tab/segment_statistics_helpers";
import { describe, expect, it } from "vitest";

const voxelSizeWithFactor = (factor: Vector3): VoxelSize => ({
  factor,
  unit: UnitLong.nm,
});

const ALL_METRICS: SegmentStatisticsMetric[] = [
  "positions",
  "max_distances",
  "volumes",
  "center_of_mass",
  "covariance_matrix",
  "surfaces",
  "sphericities",
];

const fileInfo = (
  availableMetrics: SegmentStatisticsMetric[],
  mappingName?: string,
): SegmentStatisticsFileInfo => ({
  mag: [1, 1, 1],
  availableMetrics,
  ...(mappingName != null ? { mappingName } : {}),
});

describe("covarianceMatrixToPrincipalExtents", () => {
  it("should return the square roots of the variances of a diagonal matrix, descending", () => {
    const covariance: SegmentCovarianceMatrix = [
      [4, 0, 0],
      [0, 9, 0],
      [0, 0, 1],
    ];
    expect(covarianceMatrixToPrincipalExtents(covariance, voxelSizeWithFactor([1, 1, 1]))).toEqual([
      3, 2, 1,
    ]);
  });

  it("should scale each axis by the voxel size", () => {
    const covariance: SegmentCovarianceMatrix = [
      [4, 0, 0],
      [0, 9, 0],
      [0, 0, 1],
    ];
    // Variances are scaled by factor², so the extents are scaled by the factor itself:
    // [3 * 2, 2 * 2, 1 * 4] = [6, 4, 4].
    expect(covarianceMatrixToPrincipalExtents(covariance, voxelSizeWithFactor([2, 2, 4]))).toEqual([
      6, 4, 4,
    ]);
  });

  it("should be invariant under rotation for isotropic voxels", () => {
    const rotation = new Matrix4().makeRotationFromEuler(new Euler(0.3, -0.7, 1.1));
    const rotationMatrix = new Matrix([
      [rotation.elements[0], rotation.elements[4], rotation.elements[8]],
      [rotation.elements[1], rotation.elements[5], rotation.elements[9]],
      [rotation.elements[2], rotation.elements[6], rotation.elements[10]],
    ]);
    const diagonal = Matrix.diag([4, 9, 1]);
    // R · C · Rᵀ describes the same ellipsoid in a rotated frame.
    const rotated = rotationMatrix.mmul(diagonal).mmul(rotationMatrix.transpose());

    const extents = covarianceMatrixToPrincipalExtents(
      rotated.to2DArray() as SegmentCovarianceMatrix,
      voxelSizeWithFactor([1, 1, 1]),
    );

    for (const [index, expected] of [3, 2, 1].entries()) {
      expect(extents[index]).toBeCloseTo(expected, 10);
    }
  });

  it("should clamp eigenvalues that are negative due to floating point error", () => {
    const degenerate: SegmentCovarianceMatrix = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    expect(covarianceMatrixToPrincipalExtents(degenerate, voxelSizeWithFactor([1, 1, 1]))).toEqual([
      0, 0, 0,
    ]);
  });
});

describe("getAvailableFileMetrics", () => {
  it("should offer nothing without a statistics file", () => {
    expect(getAvailableFileMetrics(null, null)).toEqual({
      maxDistance: false,
      sphericity: false,
      centerOfMass: false,
      covariance: false,
    });
  });

  it("should offer everything when the file has no mapping and none is active", () => {
    expect(getAvailableFileMetrics(fileInfo(ALL_METRICS), null)).toEqual({
      maxDistance: true,
      sphericity: true,
      centerOfMass: true,
      covariance: true,
    });
  });

  it("should offer everything when the active mapping is the file's own mapping", () => {
    expect(
      getAvailableFileMetrics(fileInfo(ALL_METRICS, "agglomerate_view_5"), "agglomerate_view_5"),
    ).toEqual({
      maxDistance: true,
      sphericity: true,
      centerOfMass: true,
      covariance: true,
    });
  });

  it("should only offer recombinable metrics when a mapping is applied to an oversegmentation file", () => {
    expect(getAvailableFileMetrics(fileInfo(ALL_METRICS), "agglomerate_view_5")).toEqual({
      maxDistance: false,
      sphericity: false,
      centerOfMass: true,
      covariance: true,
    });
  });

  it("should offer nothing when the file's own mapping differs from the active one", () => {
    expect(getAvailableFileMetrics(fileInfo(ALL_METRICS, "agglomerate_view_5"), null)).toEqual({
      maxDistance: false,
      sphericity: false,
      centerOfMass: false,
      covariance: false,
    });
  });

  it("should require the arrays that recombination depends on", () => {
    // Recombining centers of mass needs volumes as weights, and covariance additionally needs the
    // per-oversegment centers of mass. Both are only needed when a mapping is applied.
    const withoutVolumes = ALL_METRICS.filter((metric) => metric !== "volumes");
    expect(getAvailableFileMetrics(fileInfo(withoutVolumes), "agglomerate_view_5")).toMatchObject({
      centerOfMass: false,
      covariance: false,
    });
    expect(getAvailableFileMetrics(fileInfo(withoutVolumes), null)).toMatchObject({
      centerOfMass: true,
      covariance: true,
    });

    const withoutCenterOfMass = ALL_METRICS.filter((metric) => metric !== "center_of_mass");
    expect(
      getAvailableFileMetrics(fileInfo(withoutCenterOfMass), "agglomerate_view_5"),
    ).toMatchObject({ centerOfMass: false, covariance: false });
    expect(getAvailableFileMetrics(fileInfo(withoutCenterOfMass, "agglo"), "agglo")).toMatchObject({
      centerOfMass: false,
      covariance: true,
    });
  });

  it("should not offer metrics whose array is missing from the file", () => {
    expect(getAvailableFileMetrics(fileInfo(["volumes", "surfaces"]), null)).toEqual({
      maxDistance: false,
      sphericity: false,
      centerOfMass: false,
      covariance: false,
    });
  });
});
