import { useQuery } from "@tanstack/react-query";
import { getSegmentBoundingBoxes, getSegmentSurfaceArea, getSegmentVolumes } from "admin/rest_api";
import { Alert, Modal, Spin, Table } from "antd";
import { formatNumberToArea, formatNumberToVolume } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { pluralize } from "libs/utils";
import capitalize from "lodash/capitalize";
import { useCallback, useMemo } from "react";
import type { APISegmentationLayer, VoxelSize } from "types/api_types";
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
import { api } from "viewer/singletons";
import type { Segment } from "viewer/store";
import type { SegmentHierarchyGroup, SegmentHierarchyNode } from "./segments_view_helper";

const getSegmentStatisticsCSVHeader = (dataSourceUnit: string) => {
  const capitalizedUnit = capitalize(dataSourceUnit);
  return `segmentId,segmentName,groupId,groupName,volumeInVoxel,volumeIn${capitalizedUnit}3,surfaceAreaIn${capitalizedUnit}2,boundingBoxTopLeftPositionX,boundingBoxTopLeftPositionY,boundingBoxTopLeftPositionZ,boundingBoxSizeX,boundingBoxSizeY,boundingBoxSizeZ`;
};

const ADDITIONAL_COORDS_COLUMN = "additionalCoordinates";

type Props = {
  onCancel: (...args: Array<any>) => any;
  tracingId: string | undefined;
  visibleSegmentationLayer: APISegmentationLayer;
  relevantSegments: Segment[];
  parentGroup: number;
  groupTree: SegmentHierarchyNode[];
};

type SegmentInfo = {
  key: number;
  additionalCoordinates: string;
  segmentId: number;
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
};

const exportStatisticsToCSV = (
  segmentInformation: SegmentInfo[],
  tracingIdOrDatasetName: string,
  groupIdToExport: number,
  hasAdditionalCoords: boolean,
  voxelSize: VoxelSize,
) => {
  const segmentStatisticsAsRows = segmentInformation.map((row) => {
    const maybeAdditionalCoords = hasAdditionalCoords ? [row.additionalCoordinates] : [];
    return transformToCSVRow([
      ...maybeAdditionalCoords,
      row.segmentId,
      row.segmentName,
      row.groupId,
      row.groupName,
      row.volumeInVoxel,
      row.volumeInUnit3,
      row.surfaceAreaInUnit2,
      ...(row.boundingBoxTopLeft || []),
      ...(row.boundingBoxPosition || []),
    ]);
  });

  const csv_header = hasAdditionalCoords
    ? [ADDITIONAL_COORDS_COLUMN, getSegmentStatisticsCSVHeader(voxelSize.unit)].join(",")
    : getSegmentStatisticsCSVHeader(voxelSize.unit);
  const filename =
    groupIdToExport === -1
      ? `segmentStatistics_${tracingIdOrDatasetName}.csv`
      : `segmentStatistics_${tracingIdOrDatasetName}_group-${groupIdToExport}.csv`;
  saveAsCSV([csv_header], segmentStatisticsAsRows, filename);
};

export function SegmentStatisticsModal({
  onCancel,
  tracingId,
  visibleSegmentationLayer,
  relevantSegments: segments,
  parentGroup,
  groupTree,
}: Props) {
  const { dataset, annotation } = useWkSelector((state) => state);
  const magInfo = getMagInfo(visibleSegmentationLayer.mags);
  const layersFinestMag = magInfo.getFinestMag();
  const voxelSize = dataset.dataSource.scale;

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
      ? state.localSegmentationData[visibleSegmentationLayer.name].currentMeshFile
      : null,
  );
  const mappingName: string | null | undefined = useWkSelector(getCurrentMappingName);

  const segmentIds = useMemo(() => segments.map((s) => s.id), [segments]);

  const additionalCoordStringForCsv = getAdditionalCoordinatesAsString(additionalCoordinates);

  const getGroupIdForSegment = useCallback(
    (segment: Segment) => {
      if (segment.groupId != null) return segment.groupId;
      const rootGroup = groupTree.find(
        (node) => node.type === "group" && node.id === -1,
      ) as SegmentHierarchyGroup | null;
      if (rootGroup?.children.find((node: SegmentHierarchyNode) => node.id === segment.id)) {
        return -1;
      } else {
        return null;
      }
    },
    [groupTree],
  );

  const getGroupNameForId = useCallback(
    (groupId: number | null) => {
      if (groupId == null) return "";
      if (groupId === -1) return "root";
      const potentialGroupNode = groupTree.find(
        (node) => node.type === "group" && node.id === groupId,
      );
      return potentialGroupNode?.name == null ? "" : potentialGroupNode.name;
    },
    [groupTree],
  );

  const {
    data: volumes,
    isLoading: isLoadingVolumes,
    isError: isErrorVolumes,
  } = useQuery({
    queryKey: [
      "segmentVolumes",
      segmentIds,
      layersFinestMag,
      additionalCoordinates,
      mappingName,
      storeInfoType,
    ],
    queryFn: async () => {
      await api.tracing.save();
      return getSegmentVolumes(
        storeInfoType,
        layersFinestMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      );
    },
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
      return getSegmentBoundingBoxes(
        storeInfoType,
        layersFinestMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      );
    },
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
      layersFinestMag,
      additionalCoordinates,
      mappingName,
      storeInfoType,
      currentMeshFile?.name,
    ],
    queryFn: async () => {
      await api.tracing.save();
      return getSegmentSurfaceArea(
        storeInfoType,
        layersFinestMag,
        currentMeshFile?.name,
        segmentIds,
        additionalCoordinates,
        mappingName,
      );
    },
    gcTime: 0,
  });

  const statisticsList = useMemo(() => {
    return segments.map((segment, i) => {
      const currentGroupId = getGroupIdForSegment(segment);

      let volumeStats = {};
      if (volumes) {
        const volumeInVoxel = volumes[i];
        const volumeInUnit3 = voxelToVolumeInUnit(voxelSize, layersFinestMag, volumeInVoxel);
        volumeStats = {
          volumeInVoxel,
          volumeInUnit3,
          formattedSize: formatNumberToVolume(
            volumeInUnit3,
            LongUnitToShortUnitMap[voxelSize.unit],
          ),
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
          formattedSurfaceArea: formatNumberToArea(
            surfaceAreaInUnit2,
            LongUnitToShortUnitMap[voxelSize.unit],
          ),
        };
      }

      return {
        key: segment.id,
        additionalCoordinates: additionalCoordStringForCsv,
        segmentId: segment.id,
        segmentName: segment.name == null ? `Segment ${segment.id}` : segment.name,
        groupId: currentGroupId,
        groupName: getGroupNameForId(currentGroupId),
        ...volumeStats,
        ...bboxStats,
        ...surfaceStats,
      } as SegmentInfo;
    });
  }, [
    segments,
    volumes,
    boundingBoxes,
    surfaceAreas,
    getGroupIdForSegment,
    getGroupNameForId,
    additionalCoordStringForCsv,
    voxelSize,
    layersFinestMag,
  ]);

  const columns = [
    { title: "Segment ID", dataIndex: "segmentId", key: "segmentId" },
    { title: "Segment Name", dataIndex: "segmentName", key: "segmentName" },
    {
      title: "Volume",
      dataIndex: "formattedSize",
      key: "formattedSize",
      render: (text: string) => {
        if (isLoadingVolumes) return <Spin size="small" />;
        if (isErrorVolumes) return "n/a";
        return text;
      },
    },
    {
      title: "Surface Area",
      dataIndex: "formattedSurfaceArea",
      key: "formattedSurfaceArea",
      render: (text: string) => {
        if (isLoadingSurfaceAreas) return <Spin size="small" />;
        if (isErrorSurfaceAreas) return "n/a";
        return text;
      },
    },
    {
      title: "Bounding Box\nTop Left Position",
      dataIndex: "boundingBoxTopLeftAsString",
      key: "boundingBoxTopLeft",
      width: 150,
      render: (text: string) => {
        if (isLoadingBboxes) return <Spin size="small" />;
        if (isErrorBboxes) return "n/a";
        return text;
      },
    },
    {
      title: "Bounding Box\nSize in vx",
      dataIndex: "boundingBoxPositionAsString",
      key: "boundingBoxPosition",
      width: 150,
      render: (text: string) => {
        if (isLoadingBboxes) return <Spin size="small" />;
        if (isErrorBboxes) return "n/a";
        return text;
      },
    },
  ];

  const isErrorCase = isErrorVolumes || isErrorBboxes || isErrorSurfaceAreas;

  return (
    <Modal
      open
      title="Segment Statistics"
      onCancel={onCancel}
      width={800}
      onOk={() =>
        !isErrorCase &&
        exportStatisticsToCSV(
          statisticsList,
          tracingId || dataset.name,
          parentGroup,
          hasAdditionalCoords,
          voxelSize,
        )
      }
      okText="Export to CSV"
      okButtonProps={{
        disabled: isErrorCase || isLoadingVolumes || isLoadingBboxes || isLoadingSurfaceAreas,
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
      <Table
        dataSource={statisticsList}
        columns={columns}
        style={{ whiteSpace: "pre" }}
        scroll={{ x: "max-content" }}
      />
    </Modal>
  );
}
