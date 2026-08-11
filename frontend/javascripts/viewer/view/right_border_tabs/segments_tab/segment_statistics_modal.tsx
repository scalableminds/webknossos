import { Alert, Modal, Space, Spin, Table } from "antd";
import { formatNumberToArea, formatNumberToLength, formatNumberToVolume } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { pluralize } from "libs/utils";
import capitalize from "lodash-es/capitalize";
import { useCallback, useMemo } from "react";
import type { APISegmentationLayer, SegmentCovarianceMatrix } from "types/api_types";
import { LongUnitToShortUnitMap, type Vector3 } from "viewer/constants";
import {
  getAdditionalCoordinatesAsString,
  hasAdditionalCoordinates,
} from "viewer/model/accessors/flycam_accessor";
import { saveAsCSV, transformToCSVRow } from "viewer/model/helpers/csv_helpers";
import { getBoundingBoxInMag1 } from "viewer/model/sagas/volume/helpers";
import { voxelToVolumeInUnit } from "viewer/model/scaleinfo";
import type { Segment, SegmentGroup } from "viewer/store";
import { findGroup, MISSING_GROUP_ID } from "../shared/tree_hierarchy_view_helpers";
import { useSegmentStatistics } from "./hooks/use_segment_statistics";
import { covarianceMatrixToPrincipalExtents } from "./segment_statistics_helpers";

const ADDITIONAL_COORDS_COLUMN = "additionalCoordinates";

type Props = {
  onCancel: (...args: Array<any>) => any;
  tracingId: string | undefined;
  visibleSegmentationLayer: APISegmentationLayer;
  relevantSegments: Segment[];
  /** Appended to the exported filename to tell exports of the same layer apart. */
  csvFilenameSuffix: string | null;
  segmentGroups: SegmentGroup[];
};

type SegmentInfo = {
  key: string;
  additionalCoordinates: string;
  segmentId: bigint;
  segmentName: string;
  groupId: number | undefined | null;
  groupName: string;
  volumeInUnit3: number | undefined;
  formattedSize: string | undefined;
  volumeInVoxel: number | undefined;
  surfaceAreaInUnit2: number | undefined;
  formattedSurfaceArea: string | undefined;
  boundingBoxTopLeft: Vector3 | undefined;
  boundingBoxTopLeftAsString: string | undefined;
  boundingBoxPosition: Vector3 | undefined;
  boundingBoxPositionAsString: string | undefined;
  maxDistanceInUnit: number | undefined;
  formattedMaxDistance: string | undefined;
  sphericity: number | undefined;
  formattedSphericity: string | undefined;
  centerOfMass: Vector3 | undefined;
  centerOfMassAsString: string | undefined;
  principalExtents: Vector3 | undefined;
  formattedPrincipalExtents: string | undefined;
  covarianceMatrix: SegmentCovarianceMatrix | undefined;
};

type CsvValue = string | number | undefined;

/*
 * Describes one statistic in both of its representations, so that the rendered table and the
 * exported CSV cannot drift apart when columns are shown conditionally. A spec without a `title`
 * is exported but not rendered; `csvHeaders` and the array returned by `getCsvValues` always have
 * the same length, so missing values keep the CSV columns aligned.
 */
type StatisticSpec = {
  key: string;
  title?: string;
  dataIndex?: keyof SegmentInfo;
  width?: number;
  isLoading?: boolean;
  isError?: boolean;
  csvHeaders: string[];
  getCsvValues: (row: SegmentInfo) => CsvValue[];
};

const exportStatisticsToCSV = (
  segmentInformation: SegmentInfo[],
  specs: StatisticSpec[],
  tracingIdOrDatasetName: string,
  filenameSuffix: string | null,
) => {
  const csvHeader = specs.flatMap((spec) => spec.csvHeaders);
  const segmentStatisticsAsRows = segmentInformation.map((row) =>
    transformToCSVRow(specs.flatMap((spec) => spec.getCsvValues(row)).map((value) => value ?? "")),
  );

  const filename =
    filenameSuffix == null
      ? `segmentStatistics_${tracingIdOrDatasetName}.csv`
      : `segmentStatistics_${tracingIdOrDatasetName}_${filenameSuffix}.csv`;
  saveAsCSV(csvHeader, segmentStatisticsAsRows, filename);
};

export function SegmentStatisticsModal({
  onCancel,
  tracingId,
  visibleSegmentationLayer,
  relevantSegments: segments,
  csvFilenameSuffix,
  segmentGroups,
}: Props) {
  const dataset = useWkSelector((state) => state.dataset);
  const voxelSize = dataset.dataSource.scale;
  const shortUnit = LongUnitToShortUnitMap[voxelSize.unit];

  const additionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);
  const hasAdditionalCoords = hasAdditionalCoordinates(additionalCoordinates);
  const additionalCoordinateStringForModal = getAdditionalCoordinatesAsString(
    additionalCoordinates,
    ", ",
  );

  const segmentIds = useMemo(() => segments.map((s) => s.id), [segments]);

  const additionalCoordStringForCsv = getAdditionalCoordinatesAsString(additionalCoordinates);

  // Omit checking that all prerequisites for segment stats (such as a segment index) are
  // met right here because that should happen before opening the modal.
  const {
    fileInfo,
    statisticsMag,
    boundingBoxMag,
    availableFileMetrics,
    volumes,
    boundingBoxes,
    surfaceAreas,
    maxDistances,
    sphericities,
    centersOfMass,
    covarianceMatrices,
  } = useSegmentStatistics({ layer: visibleSegmentationLayer, segmentIds });

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
      } as SegmentInfo;
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
      {
        key: "formattedSize",
        title: "Volume",
        dataIndex: "formattedSize",
        isLoading: volumes.isLoading,
        isError: volumes.isError,
        csvHeaders: ["volumeInVoxel", `volumeIn${capitalizedUnit}3`],
        getCsvValues: (row) => [row.volumeInVoxel, row.volumeInUnit3],
      },
      {
        key: "formattedSurfaceArea",
        title: "Surface Area",
        dataIndex: "formattedSurfaceArea",
        isLoading: surfaceAreas.isLoading,
        isError: surfaceAreas.isError,
        csvHeaders: [`surfaceAreaIn${capitalizedUnit}2`],
        getCsvValues: (row) => [row.surfaceAreaInUnit2],
      },
    );

    if (availableFileMetrics.maxDistance) {
      specs.push({
        key: "formattedMaxDistance",
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
        key: "formattedSphericity",
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
          key: "formattedPrincipalExtents",
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

  const columns = statisticSpecs
    .filter((spec) => spec.title != null)
    .map((spec) => {
      // Only the fetched statistics have a loading and error state; segment id and name are
      // rendered as plain values.
      const isFetchedStatistic = spec.isLoading !== undefined;
      return {
        title: spec.title,
        dataIndex: spec.dataIndex,
        key: spec.key,
        width: spec.width,
        render: isFetchedStatistic
          ? (text: string) => {
              if (spec.isLoading) return <Spin size="small" />;
              if (spec.isError) return "n/a";
              return text;
            }
          : undefined,
      };
    });

  // Statistics that failed are exported as empty cells rather than blocking the export, because a
  // single unavailable metric (e.g. bounding boxes on a dataset without a segment index) should not
  // make the remaining ones unexportable.
  const isAnyStatisticLoading = statisticSpecs.some((spec) => spec.isLoading);

  return (
    <Modal
      open
      title="Segment Statistics"
      onCancel={onCancel}
      width={1000}
      onOk={() =>
        exportStatisticsToCSV(
          statisticsList,
          statisticSpecs,
          tracingId || dataset.name,
          csvFilenameSuffix,
        )
      }
      okText="Export to CSV"
      okButtonProps={{ disabled: isAnyStatisticLoading }}
    >
      <Space vertical size="small">
        {hasAdditionalCoords && (
          <Alert
            title={`These statistics only refer to the current additional ${pluralize(
              "coordinate",
              additionalCoordinates?.length || 0,
            )} ${additionalCoordinateStringForModal}.`}
            type="info"
            showIcon
          />
        )}
        {fileInfo != null && (
          <Alert
            title={`Statistics are read from a precomputed segment statistics file, which was computed for mag ${fileInfo.mag.join(
              "-",
            )}.`}
            type="info"
            showIcon
          />
        )}
        <Table
          dataSource={statisticsList}
          columns={columns}
          style={{ whiteSpace: "pre" }}
          scroll={{ x: "max-content" }}
        />
      </Space>
    </Modal>
  );
}
