import { useWkSelector } from "libs/react_hooks";
import capitalize from "lodash-es/capitalize";
import { useCallback, useMemo } from "react";
import type { APISegmentationLayer } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  getAdditionalCoordinatesAsString,
  hasAdditionalCoordinates,
} from "viewer/model/accessors/flycam_accessor";
import { getBoundingBoxInMag1 } from "viewer/model/sagas/volume/helpers";
import { voxelToVolumeInUnit } from "viewer/model/scaleinfo";
import type { Segment, SegmentGroup } from "viewer/store";
import { findGroup, MISSING_GROUP_ID } from "../../shared/tree_hierarchy_view_helpers";
import {
  type CsvValue,
  covarianceMatrixToPrincipalExtents,
  type SegmentStatisticsRow,
  type StatisticSpec,
} from "../segment_statistics_helpers";
import { useSegmentStatistics } from "./use_segment_statistics";

const ADDITIONAL_COORDS_COLUMN = "additionalCoordinates";

type Options = {
  layer: APISegmentationLayer;
  segments: Segment[];
  segmentGroups: SegmentGroup[];
  // Set to false to defer fetching, e.g. until the user asks for the statistics.
  enabled?: boolean;
  // Change this to force a refetch, e.g. after the segments were edited.
  refreshToken?: number | null;
};

/*
 * Turns the raw, positional results of useSegmentStatistics into one row per segment, together with
 * the specs that describe how each statistic is rendered and exported. Views (table, CSV export)
 * should build on this instead of on the raw statistics.
 */
export function useSegmentStatisticsRows({
  layer,
  segments,
  segmentGroups,
  enabled,
  refreshToken,
}: Options) {
  const dataset = useWkSelector((state) => state.dataset);
  const voxelSize = dataset.dataSource.scale;

  const additionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);
  const hasAdditionalCoords = hasAdditionalCoordinates(additionalCoordinates);
  const segmentIds = useMemo(() => segments.map((s) => s.id), [segments]);

  const additionalCoordStringForCsv = getAdditionalCoordinatesAsString(additionalCoordinates);

  // Whether statistics are available at all (e.g. a segment index exists) is expected to be
  // checked by the caller before rendering a statistics view.
  const {
    areSegmentStatisticsAvailable,
    fileInfo,
    statisticsMag,
    boundingBoxMag,
    isBoundingBoxAvailable,
    isVolumeAvailable,
    isSurfaceAreaAvailable,
    availableFileMetrics,
    volumes,
    boundingBoxes,
    surfaceAreas,
    maxDistances,
    sphericities,
    centersOfMass,
    covarianceMatrices,
  } = useSegmentStatistics({ layer, segmentIds, enabled, refreshToken });

  const getGroupIdForSegment = useCallback(
    // Segments without a groupId belong to the (virtual) root group.
    (segment: Segment) => segment.groupId ?? MISSING_GROUP_ID,
    [],
  );

  const getGroupNameForId = useCallback(
    (groupId: number | null) => {
      if (groupId == null) return "";
      if (groupId === MISSING_GROUP_ID) return "root";
      return findGroup(segmentGroups, groupId)?.name ?? "";
    },
    [segmentGroups],
  );

  const statisticsList = useMemo(() => {
    return segments.map((segment, i): SegmentStatisticsRow => {
      const currentGroupId = getGroupIdForSegment(segment);
      const row: SegmentStatisticsRow = {
        key: segment.id.toString(),
        segment,
        additionalCoordinates: additionalCoordStringForCsv,
        segmentId: segment.id,
        segmentName: segment.name == null ? `Segment ${segment.id}` : segment.name,
        groupId: currentGroupId,
        groupName: getGroupNameForId(currentGroupId),
      };

      if (volumes.data) {
        row.volumeInVoxel = volumes.data[i];
        row.volumeInUnit3 = voxelToVolumeInUnit(voxelSize, statisticsMag, row.volumeInVoxel);
      }
      if (boundingBoxes.data) {
        const boundingBoxInMag1 = getBoundingBoxInMag1(boundingBoxes.data[i], boundingBoxMag);
        row.boundingBoxTopLeft = boundingBoxInMag1.topLeft;
        row.boundingBoxSize = [
          boundingBoxInMag1.width,
          boundingBoxInMag1.height,
          boundingBoxInMag1.depth,
        ];
      }
      if (surfaceAreas.data) {
        row.surfaceAreaInUnit2 = surfaceAreas.data[i];
      }
      if (maxDistances.data) {
        row.maxDistanceInUnit = maxDistances.data[i];
      }
      if (sphericities.data) {
        row.sphericity = sphericities.data[i];
      }
      if (centersOfMass.data) {
        row.centerOfMass = centersOfMass.data[i];
      }
      if (covarianceMatrices.data) {
        row.covarianceMatrix = covarianceMatrices.data[i];
        row.principalExtents = covarianceMatrixToPrincipalExtents(row.covarianceMatrix, voxelSize);
      }
      return row;
    });
  }, [
    segments,
    volumes.data,
    boundingBoxes.data,
    surfaceAreas.data,
    maxDistances.data,
    sphericities.data,
    centersOfMass.data,
    covarianceMatrices.data,
    getGroupIdForSegment,
    getGroupNameForId,
    additionalCoordStringForCsv,
    voxelSize,
    statisticsMag,
    boundingBoxMag,
  ]);

  const statisticSpecs: StatisticSpec[] = useMemo(() => {
    const capitalizedUnit = capitalize(voxelSize.unit);
    const emptyVector: CsvValue[] = [undefined, undefined, undefined];
    const specs: StatisticSpec[] = [];

    if (hasAdditionalCoords) {
      specs.push({
        key: ADDITIONAL_COORDS_COLUMN,
        csvHeaders: [ADDITIONAL_COORDS_COLUMN],
        getCsvValues: (row) => [row.additionalCoordinates],
      });
    }

    // The segment itself is rendered by the table in a dedicated column.
    specs.push(
      {
        key: "segmentId",
        csvHeaders: ["segmentId"],
        getCsvValues: (row) => [row.segmentId],
      },
      {
        key: "segmentName",
        csvHeaders: ["segmentName"],
        getCsvValues: (row) => [row.segmentName],
      },
      {
        key: "group",
        csvHeaders: ["groupId", "groupName"],
        getCsvValues: (row) => [row.groupId ?? undefined, row.groupName],
      },
    );

    if (isVolumeAvailable) {
      specs.push(
        {
          key: "voxelCount",
          title: "Voxel Count",
          value: {
            kind: "number",
            unit: "vx",
            fractionDigits: 0,
            get: (row) => row.volumeInVoxel,
          },
          isLoading: volumes.isLoading,
          isError: volumes.isError,
          csvHeaders: ["volumeInVoxel"],
          getCsvValues: (row) => [row.volumeInVoxel],
        },
        {
          key: "volume",
          title: "Volume",
          value: { kind: "number", unit: { dimension: 3 }, get: (row) => row.volumeInUnit3 },
          isLoading: volumes.isLoading,
          isError: volumes.isError,
          csvHeaders: [`volumeIn${capitalizedUnit}3`],
          getCsvValues: (row) => [row.volumeInUnit3],
        },
      );
    }

    if (isSurfaceAreaAvailable) {
      specs.push({
        key: "surfaceArea",
        title: "Surface Area",
        value: { kind: "number", unit: { dimension: 2 }, get: (row) => row.surfaceAreaInUnit2 },
        isLoading: surfaceAreas.isLoading,
        isError: surfaceAreas.isError,
        csvHeaders: [`surfaceAreaIn${capitalizedUnit}2`],
        getCsvValues: (row) => [row.surfaceAreaInUnit2],
      });
    }

    if (availableFileMetrics.maxDistance) {
      specs.push({
        key: "maxDistance",
        title: "Max Distance",
        value: {
          kind: "number",
          unit: { dimension: 1 },
          aggregation: "max",
          get: (row) => row.maxDistanceInUnit,
        },
        isLoading: maxDistances.isLoading,
        isError: maxDistances.isError,
        csvHeaders: [`maxDistanceIn${capitalizedUnit}`],
        getCsvValues: (row) => [row.maxDistanceInUnit],
      });
    }

    if (availableFileMetrics.sphericity) {
      specs.push({
        key: "sphericity",
        title: "Sphericity",
        value: {
          kind: "number",
          unit: "0–1",
          fractionDigits: 3,
          aggregation: "mean",
          get: (row) => row.sphericity,
        },
        isLoading: sphericities.isLoading,
        isError: sphericities.isError,
        csvHeaders: ["sphericity"],
        getCsvValues: (row) => [row.sphericity],
      });
    }

    if (availableFileMetrics.covariance) {
      specs.push(
        {
          key: "principalExtents",
          title: "Principal Extents",
          value: {
            kind: "vector",
            unit: { dimension: 1 },
            sortBy: "first",
            get: (row) => row.principalExtents,
          },
          isLoading: covarianceMatrices.isLoading,
          isError: covarianceMatrices.isError,
          csvHeaders: [1, 2, 3].map((index) => `principalExtent${index}In${capitalizedUnit}`),
          getCsvValues: (row) => row.principalExtents ?? emptyVector,
        },
        {
          key: "covarianceMatrix",
          csvHeaders: [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => `covariance${i}${j}`)),
          getCsvValues: (row) =>
            row.covarianceMatrix?.flat() ?? new Array<CsvValue>(9).fill(undefined),
        },
      );
    }

    if (isBoundingBoxAvailable) {
      specs.push({
        key: "boundingBox",
        title: "Bounding Box",
        // The table shows the top-left corner above the size and sorts by the volume of the box.
        value: {
          kind: "vector",
          unit: "vx",
          fractionDigits: 0,
          sortBy: "product",
          getPosition: (row) => row.boundingBoxTopLeft,
          get: (row) => row.boundingBoxSize,
        },
        isLoading: boundingBoxes.isLoading,
        isError: boundingBoxes.isError,
        csvHeaders: [
          ...["X", "Y", "Z"].map((axis) => `boundingBoxTopLeftPosition${axis}`),
          ...["X", "Y", "Z"].map((axis) => `boundingBoxSize${axis}`),
        ],
        getCsvValues: (row) => [
          ...(row.boundingBoxTopLeft ?? emptyVector),
          ...(row.boundingBoxSize ?? emptyVector),
        ],
      });
    }

    if (availableFileMetrics.centerOfMass) {
      specs.push({
        key: "centerOfMass",
        title: "Center of Mass",
        value: {
          kind: "vector",
          unit: "vx",
          fractionDigits: 0,
          isPosition: true,
          get: (row) => row.centerOfMass?.map(Math.round) as Vector3 | undefined,
        },
        isLoading: centersOfMass.isLoading,
        isError: centersOfMass.isError,
        csvHeaders: ["X", "Y", "Z"].map((axis) => `centerOfMass${axis}`),
        getCsvValues: (row) => row.centerOfMass ?? emptyVector,
      });
    }

    return specs;
  }, [
    voxelSize.unit,
    hasAdditionalCoords,
    availableFileMetrics,
    isBoundingBoxAvailable,
    isVolumeAvailable,
    isSurfaceAreaAvailable,
    volumes.isLoading,
    volumes.isError,
    surfaceAreas.isLoading,
    surfaceAreas.isError,
    maxDistances.isLoading,
    maxDistances.isError,
    sphericities.isLoading,
    sphericities.isError,
    covarianceMatrices.isLoading,
    covarianceMatrices.isError,
    boundingBoxes.isLoading,
    boundingBoxes.isError,
    centersOfMass.isLoading,
    centersOfMass.isError,
  ]);

  const isAnyStatisticLoading = statisticSpecs.some((spec) => spec.isLoading);

  return {
    rows: statisticsList,
    statisticSpecs,
    isAnyStatisticLoading,
    fileInfo,
    areSegmentStatisticsAvailable,
  };
}
