import { formatNumberToArea, formatNumberToLength, formatNumberToVolume } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import capitalize from "lodash-es/capitalize";
import { useCallback, useMemo } from "react";
import type { APISegmentationLayer } from "types/api_types";
import { LongUnitToShortUnitMap, type Vector3 } from "viewer/constants";
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
};

/*
 * Turns the raw, positional results of useSegmentStatistics into one row per segment, together with
 * the specs that describe how each statistic is rendered and exported. Views (table, CSV export)
 * should build on this instead of on the raw statistics.
 */
export function useSegmentStatisticsRows({ layer, segments, segmentGroups, enabled }: Options) {
  const dataset = useWkSelector((state) => state.dataset);
  const voxelSize = dataset.dataSource.scale;
  const shortUnit = LongUnitToShortUnitMap[voxelSize.unit];

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
  } = useSegmentStatistics({ layer, segmentIds, enabled });

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
    return segments.map((segment, i) => {
      const currentGroupId = getGroupIdForSegment(segment);

      let volumeStats = {};
      if (volumes.data) {
        const volumeInVoxel = volumes.data[i];
        const volumeInUnit3 = voxelToVolumeInUnit(voxelSize, statisticsMag, volumeInVoxel);
        volumeStats = {
          volumeInVoxel,
          volumeInUnit3,
          formattedSize: formatNumberToVolume(volumeInUnit3, shortUnit),
        };
      }

      let bboxStats = {};
      if (boundingBoxes.data) {
        const boundingBoxInMag1 = getBoundingBoxInMag1(boundingBoxes.data[i], boundingBoxMag);
        bboxStats = {
          boundingBoxTopLeft: boundingBoxInMag1.topLeft,
          boundingBoxTopLeftAsString: `(${boundingBoxInMag1.topLeft.join(", ")})`,
          boundingBoxPosition: [
            boundingBoxInMag1.width,
            boundingBoxInMag1.height,
            boundingBoxInMag1.depth,
          ] as Vector3,
          boundingBoxPositionAsString: `(${boundingBoxInMag1.width}, ${boundingBoxInMag1.height}, ${boundingBoxInMag1.depth})`,
        };
      }

      let surfaceStats = {};
      if (surfaceAreas.data) {
        const surfaceAreaInUnit2 = surfaceAreas.data[i];
        surfaceStats = {
          surfaceAreaInUnit2,
          formattedSurfaceArea: formatNumberToArea(surfaceAreaInUnit2, shortUnit),
        };
      }

      let maxDistanceStats = {};
      if (maxDistances.data) {
        const maxDistanceInUnit = maxDistances.data[i];
        maxDistanceStats = {
          maxDistanceInUnit,
          formattedMaxDistance: formatNumberToLength(maxDistanceInUnit, shortUnit),
        };
      }

      let sphericityStats = {};
      if (sphericities.data) {
        const sphericity = sphericities.data[i];
        sphericityStats = {
          sphericity,
          formattedSphericity: sphericity.toFixed(3),
        };
      }

      let centerOfMassStats = {};
      if (centersOfMass.data) {
        const centerOfMass = centersOfMass.data[i];
        centerOfMassStats = {
          centerOfMass,
          centerOfMassAsString: `(${centerOfMass.map((value) => Math.round(value)).join(", ")})`,
        };
      }

      let covarianceStats = {};
      if (covarianceMatrices.data) {
        const covarianceMatrix = covarianceMatrices.data[i];
        const principalExtents = covarianceMatrixToPrincipalExtents(covarianceMatrix, voxelSize);
        covarianceStats = {
          covarianceMatrix,
          principalExtents,
          formattedPrincipalExtents: principalExtents
            .map((extent) => formatNumberToLength(extent, shortUnit))
            .join(" × "),
        };
      }

      return {
        key: segment.id.toString(),
        additionalCoordinates: additionalCoordStringForCsv,
        segmentId: segment.id,
        segmentName: segment.name == null ? `Segment ${segment.id}` : segment.name,
        groupId: currentGroupId,
        groupName: getGroupNameForId(currentGroupId),
        ...volumeStats,
        ...bboxStats,
        ...surfaceStats,
        ...maxDistanceStats,
        ...sphericityStats,
        ...centerOfMassStats,
        ...covarianceStats,
      } as SegmentStatisticsRow;
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
    shortUnit,
    statisticsMag,
    boundingBoxMag,
  ]);

  const statisticSpecs: StatisticSpec[] = useMemo(() => {
    const capitalizedUnit = capitalize(voxelSize.unit);
    const specs: StatisticSpec[] = [];

    if (hasAdditionalCoords) {
      specs.push({
        key: ADDITIONAL_COORDS_COLUMN,
        csvHeaders: [ADDITIONAL_COORDS_COLUMN],
        getCsvValues: (row) => [row.additionalCoordinates],
      });
    }

    specs.push(
      {
        key: "segmentId",
        title: "Segment ID",
        dataIndex: "segmentId",
        csvHeaders: ["segmentId"],
        getCsvValues: (row) => [row.segmentId],
      },
      {
        key: "segmentName",
        title: "Segment Name",
        dataIndex: "segmentName",
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
      specs.push({
        key: "volume",
        title: "Volume",
        dataIndex: "formattedSize",
        isLoading: volumes.isLoading,
        isError: volumes.isError,
        csvHeaders: ["volumeInVoxel", `volumeIn${capitalizedUnit}3`],
        getCsvValues: (row) => [row.volumeInVoxel, row.volumeInUnit3],
      });
    }

    if (isSurfaceAreaAvailable) {
      specs.push({
        key: "surfaceArea",
        title: "Surface Area",
        dataIndex: "formattedSurfaceArea",
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
        dataIndex: "formattedMaxDistance",
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
        dataIndex: "formattedSphericity",
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
          dataIndex: "formattedPrincipalExtents",
          width: 200,
          isLoading: covarianceMatrices.isLoading,
          isError: covarianceMatrices.isError,
          csvHeaders: [1, 2, 3].map((index) => `principalExtent${index}In${capitalizedUnit}`),
          getCsvValues: (row) => row.principalExtents ?? [undefined, undefined, undefined],
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
      specs.push(
        {
          key: "boundingBoxTopLeft",
          title: "Bounding Box\nTop Left Position",
          dataIndex: "boundingBoxTopLeftAsString",
          width: 150,
          isLoading: boundingBoxes.isLoading,
          isError: boundingBoxes.isError,
          csvHeaders: ["X", "Y", "Z"].map((axis) => `boundingBoxTopLeftPosition${axis}`),
          getCsvValues: (row) => row.boundingBoxTopLeft ?? [undefined, undefined, undefined],
        },
        {
          key: "boundingBoxPosition",
          title: "Bounding Box\nSize in vx",
          dataIndex: "boundingBoxPositionAsString",
          width: 150,
          isLoading: boundingBoxes.isLoading,
          isError: boundingBoxes.isError,
          csvHeaders: ["X", "Y", "Z"].map((axis) => `boundingBoxSize${axis}`),
          getCsvValues: (row) => row.boundingBoxPosition ?? [undefined, undefined, undefined],
        },
      );
    }

    if (availableFileMetrics.centerOfMass) {
      specs.push({
        key: "centerOfMass",
        title: "Center of Mass\nin vx",
        dataIndex: "centerOfMassAsString",
        width: 150,
        isLoading: centersOfMass.isLoading,
        isError: centersOfMass.isError,
        csvHeaders: ["X", "Y", "Z"].map((axis) => `centerOfMass${axis}`),
        getCsvValues: (row) => row.centerOfMass ?? [undefined, undefined, undefined],
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
