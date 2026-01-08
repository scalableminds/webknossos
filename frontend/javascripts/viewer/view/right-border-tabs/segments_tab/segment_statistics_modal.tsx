import { getSegmentBoundingBoxes, getSegmentSurfaceArea, getSegmentVolumes } from "admin/rest_api";
import { Alert, Modal, Spin, Table } from "antd";
import { formatNumberToArea, formatNumberToVolume } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { pluralize } from "libs/utils";
import capitalize from "lodash/capitalize";
import { useCallback, useEffect, useMemo, useState } from "react";
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

const MODAL_ERROR_MESSAGE =
  "Segment statistics could not be fetched. Check the console for more details.";

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
  volumeInUnit3: number;
  formattedSize: string;
  volumeInVoxel: number;
  surfaceAreaInUnit2: number;
  formattedSurfaceArea: string;
  boundingBoxTopLeft: Vector3;
  boundingBoxTopLeftAsString: string;
  boundingBoxPosition: Vector3;
  boundingBoxPositionAsString: string;
};

const exportStatisticsToCSV = (
  segmentInformation: Array<SegmentInfo>,
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
      ...row.boundingBoxTopLeft,
      ...row.boundingBoxPosition,
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

  const [statistics, setStatistics] = useState<Map<number, Partial<SegmentInfo>>>(new Map());
  const [loading, setLoading] = useState({
    volumes: true,
    boundingBoxes: true,
    surfaceAreas: true,
  });

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

  const updateStats = useCallback(
    (id: number, patch: Partial<SegmentInfo>) => {
      setStatistics((prev) => {
        const newMap = new Map(prev);
        const segment = segments.find((s) => s.id === id);
        const current = newMap.get(id) || {
          key: id,
          segmentId: id,
          segmentName: segment?.name || `Segment ${id}`,
          additionalCoordinates: additionalCoordStringForCsv,
          groupId: segment ? getGroupIdForSegment(segment) : null,
          groupName: segment ? getGroupNameForId(getGroupIdForSegment(segment)) : "",
        };
        newMap.set(id, { ...current, ...patch });
        return newMap;
      });
    },
    [segments, additionalCoordStringForCsv, getGroupIdForSegment, getGroupNameForId],
  );

  useEffect(() => {
    const fetchStatistics = async () => {
      const segmentIds = segments.map((s) => s.id);
      await api.tracing.save();

      // Fetch Volumes
      getSegmentVolumes(
        storeInfoType,
        layersFinestMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      )
        .then((volumes) => {
          segmentIds.forEach((id, i) => {
            const volumeInUnit3 = voxelToVolumeInUnit(voxelSize, layersFinestMag, volumes[i]);
            updateStats(id, {
              volumeInVoxel: volumes[i],
              volumeInUnit3,
              formattedSize: formatNumberToVolume(
                volumeInUnit3,
                LongUnitToShortUnitMap[voxelSize.unit],
              ),
            });
          });
          setLoading((l) => ({ ...l, volumes: false }));
        })
        .catch(console.error);

      // Fetch Bounding Boxes
      getSegmentBoundingBoxes(
        storeInfoType,
        layersFinestMag,
        segmentIds,
        additionalCoordinates,
        mappingName,
      )
        .then((boundingBoxes) => {
          segmentIds.forEach((id, i) => {
            const boundingBoxInMag1 = getBoundingBoxInMag1(boundingBoxes[i], layersFinestMag);
            updateStats(id, {
              boundingBoxTopLeft: boundingBoxInMag1.topLeft,
              boundingBoxTopLeftAsString: `(${boundingBoxInMag1.topLeft.join(", ")})`,
              boundingBoxPosition: [
                boundingBoxInMag1.width,
                boundingBoxInMag1.height,
                boundingBoxInMag1.depth,
              ] as Vector3,
              boundingBoxPositionAsString: `(${boundingBoxInMag1.width}, ${boundingBoxInMag1.height}, ${boundingBoxInMag1.depth})`,
            });
          });
          setLoading((l) => ({ ...l, boundingBoxes: false }));
        })
        .catch(console.error);

      // Fetch Surface Areas
      getSegmentSurfaceArea(
        storeInfoType,
        layersFinestMag,
        currentMeshFile?.name,
        segmentIds,
        additionalCoordinates,
        mappingName,
      )
        .then((surfaceAreas) => {
          segmentIds.forEach((id, i) => {
            updateStats(id, {
              surfaceAreaInUnit2: surfaceAreas[i],
              formattedSurfaceArea: formatNumberToArea(
                surfaceAreas[i],
                LongUnitToShortUnitMap[voxelSize.unit],
              ),
            });
          });
          setLoading((l) => ({ ...l, surfaceAreas: false }));
        })
        .catch(console.error);
    };

    fetchStatistics();
  }, [
    segments,
    layersFinestMag,
    additionalCoordinates,
    mappingName,
    currentMeshFile?.name,
    voxelSize,
    storeInfoType,
    updateStats,
  ]);

  const statisticsList = useMemo(() => {
    return segments.map((s) => statistics.get(s.id) as SegmentInfo).filter(Boolean);
  }, [segments, statistics]);

  const columns = [
    { title: "Segment ID", dataIndex: "segmentId", key: "segmentId" },
    { title: "Segment Name", dataIndex: "segmentName", key: "segmentName" },
    {
      title: "Volume",
      dataIndex: "formattedSize",
      key: "formattedSize",
      render: (text: string) => (loading.volumes ? <Spin size="small" /> : text),
    },
    {
      title: "Surface Area",
      dataIndex: "formattedSurfaceArea",
      key: "formattedSurfaceArea",
      render: (text: string) => (loading.surfaceAreas ? <Spin size="small" /> : text),
    },
    {
      title: "Bounding Box\nTop Left Position",
      dataIndex: "boundingBoxTopLeftAsString",
      key: "boundingBoxTopLeft",
      width: 150,
      render: (text: string) => (loading.boundingBoxes ? <Spin size="small" /> : text),
    },
    {
      title: "Bounding Box\nSize in vx",
      dataIndex: "boundingBoxPositionAsString",
      key: "boundingBoxPosition",
      width: 150,
      render: (text: string) => (loading.boundingBoxes ? <Spin size="small" /> : text),
    },
  ];

  const isErrorCase = false; // We now handle partial loading and error individually for stats

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
      okButtonProps={{ disabled: isErrorCase }}
    >
      <Spin spinning={statisticsList.length === 0 && segments.length > 0}>
        {isErrorCase ? (
          MODAL_ERROR_MESSAGE
        ) : (
          <>
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
          </>
        )}
      </Spin>
    </Modal>
  );
}
