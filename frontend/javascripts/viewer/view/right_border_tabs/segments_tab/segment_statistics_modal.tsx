import { useQuery } from "@tanstack/react-query";
import {
  getSegmentBoundingBoxes,
  getSegmentCentersOfMass,
  getSegmentCovarianceMatrices,
  getSegmentMaxDistances,
  getSegmentSphericities,
  getSegmentSurfaceArea,
  getSegmentVolumes,
} from "admin/rest_api";
import { Alert, Modal, Spin, Table } from "antd";
import { formatNumberToArea, formatNumberToLength, formatNumberToVolume } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { pluralize } from "libs/utils";
import capitalize from "lodash-es/capitalize";
import { useCallback, useMemo } from "react";
import type { APISegmentationLayer, SegmentCovarianceMatrix } from "types/api_types";
import { LongUnitToShortUnitMap, type Vector3 } from "viewer/constants";
import { getMagInfo } from "viewer/model/accessors/dataset_accessor";
import {
  getAdditionalCoordinatesAsString,
  hasAdditionalCoordinates,
} from "viewer/model/accessors/flycam_accessor";
import { getCurrentMappingName } from "viewer/model/accessors/volumetracing_accessor";
import { saveAsCSV, transformToCSVRow } from "viewer/model/helpers/csv_helpers";
import { getBoundingBoxInMag1 } from "viewer/model/sagas/volume/helpers";
import { voxelToVolumeInUnit } from "viewer/model/scaleinfo";
import { api, Store } from "viewer/singletons";
import type { Segment, SegmentGroup } from "viewer/store";
import { findGroup, MISSING_GROUP_ID } from "../shared/tree_hierarchy_view_helpers";
import { useSegmentStatisticsFile } from "./hooks/use_segment_statistics_file";
import {
  covarianceMatrixToPrincipalExtents,
  getAvailableFileMetrics,
} from "./segment_statistics_helpers";

const ADDITIONAL_COORDS_COLUMN = "additionalCoordinates";

type Props = {
  onCancel: (...args: Array<any>) => any;
  tracingId: string | undefined;
  visibleSegmentationLayer: APISegmentationLayer;
  relevantSegments: Segment[];
  parentGroup: number;
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
  groupIdToExport: number,
) => {
  const csvHeader = specs.flatMap((spec) => spec.csvHeaders);
  const segmentStatisticsAsRows = segmentInformation.map((row) =>
    transformToCSVRow(specs.flatMap((spec) => spec.getCsvValues(row)).map((value) => value ?? "")),
  );

  const filename =
    groupIdToExport === -1
      ? `segmentStatistics_${tracingIdOrDatasetName}.csv`
      : `segmentStatistics_${tracingIdOrDatasetName}_group-${groupIdToExport}.csv`;
  saveAsCSV(csvHeader, segmentStatisticsAsRows, filename);
};

export function SegmentStatisticsModal({
  onCancel,
  tracingId,
  visibleSegmentationLayer,
  relevantSegments: segments,
  parentGroup,
  segmentGroups,
}: Props) {
  const { dataset, annotation } = useWkSelector((state) => state);
  const magInfo = getMagInfo(visibleSegmentationLayer.mags);
  const layersFinestMag = magInfo.getFinestMag();
  const voxelSize = dataset.dataSource.scale;
  const shortUnit = LongUnitToShortUnitMap[voxelSize.unit];

  // Omit checking that all prerequisites for segment stats (such as a segment index) are
  // met right here because that should happen before opening the modal.
  const storeInfoType = useMemo(
    () => ({
      dataset,
      annotation,
      tracingId: visibleSegmentationLayer.tracingId,
      segmentationLayerName: visibleSegmentationLayer.name,
    }),
    [dataset, annotation, visibleSegmentationLayer.tracingId, visibleSegmentationLayer.name],
  );
  const additionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);
  const hasAdditionalCoords = hasAdditionalCoordinates(additionalCoordinates);
  const additionalCoordinateStringForModal = getAdditionalCoordinatesAsString(
    additionalCoordinates,
    ", ",
  );
  const currentMeshFile = useWkSelector((state) =>
    visibleSegmentationLayer != null
      ? state.localSegmentationStateByLayer[visibleSegmentationLayer.name].currentMeshFile
      : null,
  );
  const mappingName: string | null | undefined = useWkSelector(getCurrentMappingName);

  const { fileInfo, isLoading: isLoadingFileInfo } =
    useSegmentStatisticsFile(visibleSegmentationLayer);
  const availableFileMetrics = useMemo(
    () => getAvailableFileMetrics(fileInfo, mappingName),
    [fileInfo, mappingName],
  );
  // A statistics file can only answer queries in its own mag or coarser ones, so requesting its mag
  // is what lets volume and surface area be served from the file instead of being recomputed.
  const statisticsMag = fileInfo?.mag ?? layersFinestMag;
  // Waiting for the file info avoids firing every query twice, once per mag.
  const areStatisticsRequestsEnabled = !isLoadingFileInfo;

  const segmentIds = useMemo(() => segments.map((s) => s.id), [segments]);

  const additionalCoordStringForCsv = getAdditionalCoordinatesAsString(additionalCoordinates);

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

  const {
    data: volumes,
    isLoading: isLoadingVolumes,
    isError: isErrorVolumes,
  } = useQuery({
    queryKey: [
      "segmentVolumes",
      segmentIds,
      statisticsMag,
      additionalCoordinates,
      mappingName,
      storeInfoType,
    ],
    queryFn: async () => {
      await api.tracing.save();
      const annotationVersion = Store.getState().annotation.version;
      return getSegmentVolumes(
        storeInfoType,
        statisticsMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
        annotationVersion,
      );
    },
    enabled: areStatisticsRequestsEnabled,
    gcTime: 0,
  });

  const {
    data: boundingBoxes,
    isLoading: isLoadingBboxes,
    isError: isErrorBboxes,
  } = useQuery({
    queryKey: [
      "segmentBoundingBoxes",
      segmentIds,
      layersFinestMag,
      additionalCoordinates,
      mappingName,
      storeInfoType,
    ],
    queryFn: async () => {
      await api.tracing.save();
      const annotationVersion = Store.getState().annotation.version;
      return getSegmentBoundingBoxes(
        storeInfoType,
        // Bounding boxes are never part of the statistics file, so they stay on the finest mag
        // rather than losing precision to the file's (potentially coarser) mag.
        layersFinestMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
        annotationVersion,
      );
    },
    enabled: areStatisticsRequestsEnabled,
    gcTime: 0,
  });

  const {
    data: surfaceAreas,
    isLoading: isLoadingSurfaceAreas,
    isError: isErrorSurfaceAreas,
  } = useQuery({
    queryKey: [
      "segmentSurfaceAreas",
      segmentIds,
      statisticsMag,
      additionalCoordinates,
      mappingName,
      storeInfoType,
      currentMeshFile?.name,
    ],
    queryFn: async () => {
      await api.tracing.save();
      const annotationVersion = Store.getState().annotation.version;
      return getSegmentSurfaceArea(
        storeInfoType,
        statisticsMag,
        currentMeshFile?.name,
        segmentIds,
        additionalCoordinates,
        mappingName,
        annotationVersion,
      );
    },
    enabled: areStatisticsRequestsEnabled,
    gcTime: 0,
  });

  const {
    data: maxDistances,
    isLoading: isLoadingMaxDistances,
    isError: isErrorMaxDistances,
  } = useQuery({
    queryKey: [
      "segmentMaxDistances",
      segmentIds,
      statisticsMag,
      additionalCoordinates,
      mappingName,
      storeInfoType,
    ],
    queryFn: () =>
      getSegmentMaxDistances(
        storeInfoType,
        statisticsMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      ),
    enabled: areStatisticsRequestsEnabled && availableFileMetrics.maxDistance,
    gcTime: 0,
  });

  const {
    data: sphericities,
    isLoading: isLoadingSphericities,
    isError: isErrorSphericities,
  } = useQuery({
    queryKey: [
      "segmentSphericities",
      segmentIds,
      statisticsMag,
      additionalCoordinates,
      mappingName,
      storeInfoType,
    ],
    queryFn: () =>
      getSegmentSphericities(
        storeInfoType,
        statisticsMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      ),
    enabled: areStatisticsRequestsEnabled && availableFileMetrics.sphericity,
    gcTime: 0,
  });

  const {
    data: centersOfMass,
    isLoading: isLoadingCentersOfMass,
    isError: isErrorCentersOfMass,
  } = useQuery({
    queryKey: [
      "segmentCentersOfMass",
      segmentIds,
      statisticsMag,
      additionalCoordinates,
      mappingName,
      storeInfoType,
    ],
    queryFn: () =>
      getSegmentCentersOfMass(
        storeInfoType,
        statisticsMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      ),
    enabled: areStatisticsRequestsEnabled && availableFileMetrics.centerOfMass,
    gcTime: 0,
  });

  const {
    data: covarianceMatrices,
    isLoading: isLoadingCovarianceMatrices,
    isError: isErrorCovarianceMatrices,
  } = useQuery({
    queryKey: [
      "segmentCovarianceMatrices",
      segmentIds,
      statisticsMag,
      additionalCoordinates,
      mappingName,
      storeInfoType,
    ],
    queryFn: () =>
      getSegmentCovarianceMatrices(
        storeInfoType,
        statisticsMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      ),
    enabled: areStatisticsRequestsEnabled && availableFileMetrics.covariance,
    gcTime: 0,
  });

  const statisticsList = useMemo(() => {
    return segments.map((segment, i) => {
      const currentGroupId = getGroupIdForSegment(segment);

      let volumeStats = {};
      if (volumes) {
        const volumeInVoxel = volumes[i];
        const volumeInUnit3 = voxelToVolumeInUnit(voxelSize, statisticsMag, volumeInVoxel);
        volumeStats = {
          volumeInVoxel,
          volumeInUnit3,
          formattedSize: formatNumberToVolume(volumeInUnit3, shortUnit),
        };
      }

      let bboxStats = {};
      if (boundingBoxes) {
        const boundingBoxInMag1 = getBoundingBoxInMag1(boundingBoxes[i], layersFinestMag);
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
      if (surfaceAreas) {
        const surfaceAreaInUnit2 = surfaceAreas[i];
        surfaceStats = {
          surfaceAreaInUnit2,
          formattedSurfaceArea: formatNumberToArea(surfaceAreaInUnit2, shortUnit),
        };
      }

      let maxDistanceStats = {};
      if (maxDistances) {
        const maxDistanceInUnit = maxDistances[i];
        maxDistanceStats = {
          maxDistanceInUnit,
          formattedMaxDistance: formatNumberToLength(maxDistanceInUnit, shortUnit),
        };
      }

      let sphericityStats = {};
      if (sphericities) {
        const sphericity = sphericities[i];
        sphericityStats = {
          sphericity,
          formattedSphericity: sphericity.toFixed(3),
        };
      }

      let centerOfMassStats = {};
      if (centersOfMass) {
        const centerOfMass = centersOfMass[i];
        centerOfMassStats = {
          centerOfMass,
          centerOfMassAsString: `(${centerOfMass.map((value) => Math.round(value)).join(", ")})`,
        };
      }

      let covarianceStats = {};
      if (covarianceMatrices) {
        const covarianceMatrix = covarianceMatrices[i];
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
    volumes,
    boundingBoxes,
    surfaceAreas,
    maxDistances,
    sphericities,
    centersOfMass,
    covarianceMatrices,
    getGroupIdForSegment,
    getGroupNameForId,
    additionalCoordStringForCsv,
    voxelSize,
    shortUnit,
    statisticsMag,
    layersFinestMag,
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
        isLoading: isLoadingVolumes,
        isError: isErrorVolumes,
        csvHeaders: ["volumeInVoxel", `volumeIn${capitalizedUnit}3`],
        getCsvValues: (row) => [row.volumeInVoxel, row.volumeInUnit3],
      },
      {
        key: "formattedSurfaceArea",
        title: "Surface Area",
        dataIndex: "formattedSurfaceArea",
        isLoading: isLoadingSurfaceAreas,
        isError: isErrorSurfaceAreas,
        csvHeaders: [`surfaceAreaIn${capitalizedUnit}2`],
        getCsvValues: (row) => [row.surfaceAreaInUnit2],
      },
    );

    if (availableFileMetrics.maxDistance) {
      specs.push({
        key: "formattedMaxDistance",
        title: "Max Distance",
        dataIndex: "formattedMaxDistance",
        isLoading: isLoadingMaxDistances,
        isError: isErrorMaxDistances,
        csvHeaders: [`maxDistanceIn${capitalizedUnit}`],
        getCsvValues: (row) => [row.maxDistanceInUnit],
      });
    }

    if (availableFileMetrics.sphericity) {
      specs.push({
        key: "formattedSphericity",
        title: "Sphericity",
        dataIndex: "formattedSphericity",
        isLoading: isLoadingSphericities,
        isError: isErrorSphericities,
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
          isLoading: isLoadingCovarianceMatrices,
          isError: isErrorCovarianceMatrices,
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

    specs.push({
      key: "boundingBoxTopLeft",
      title: "Bounding Box\nTop Left Position",
      dataIndex: "boundingBoxTopLeftAsString",
      width: 150,
      isLoading: isLoadingBboxes,
      isError: isErrorBboxes,
      csvHeaders: ["X", "Y", "Z"].map((axis) => `boundingBoxTopLeftPosition${axis}`),
      getCsvValues: (row) => row.boundingBoxTopLeft ?? [undefined, undefined, undefined],
    });

    specs.push({
      key: "boundingBoxPosition",
      title: "Bounding Box\nSize in vx",
      dataIndex: "boundingBoxPositionAsString",
      width: 150,
      isLoading: isLoadingBboxes,
      isError: isErrorBboxes,
      csvHeaders: ["X", "Y", "Z"].map((axis) => `boundingBoxSize${axis}`),
      getCsvValues: (row) => row.boundingBoxPosition ?? [undefined, undefined, undefined],
    });

    if (availableFileMetrics.centerOfMass) {
      specs.push({
        key: "centerOfMass",
        title: "Center of Mass\nin vx",
        dataIndex: "centerOfMassAsString",
        width: 150,
        isLoading: isLoadingCentersOfMass,
        isError: isErrorCentersOfMass,
        csvHeaders: ["X", "Y", "Z"].map((axis) => `centerOfMass${axis}`),
        getCsvValues: (row) => row.centerOfMass ?? [undefined, undefined, undefined],
      });
    }

    return specs;
  }, [
    voxelSize.unit,
    hasAdditionalCoords,
    availableFileMetrics,
    isLoadingVolumes,
    isErrorVolumes,
    isLoadingSurfaceAreas,
    isErrorSurfaceAreas,
    isLoadingMaxDistances,
    isErrorMaxDistances,
    isLoadingSphericities,
    isErrorSphericities,
    isLoadingCovarianceMatrices,
    isErrorCovarianceMatrices,
    isLoadingBboxes,
    isErrorBboxes,
    isLoadingCentersOfMass,
    isErrorCentersOfMass,
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
              // While the file info is still pending, no statistic has been requested yet.
              if (isLoadingFileInfo || spec.isLoading) return <Spin size="small" />;
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
          parentGroup,
        )
      }
      okText="Export to CSV"
      okButtonProps={{
        disabled: isLoadingFileInfo || isAnyStatisticLoading,
      }}
    >
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
    </Modal>
  );
}
