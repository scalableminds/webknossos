import { getSegmentBoundingBoxes, getSegmentVolumes } from "admin/admin_rest_api";
import { Alert, Modal, Spin, Table } from "antd";
import saveAs from "file-saver";
import { formatNumberToVolume } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { pluralize, transformToCSVRow } from "libs/utils";
import { LongUnitToShortUnitMap, type Vector3 } from "oxalis/constants";
import { getMagInfo, getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import {
  getAdditionalCoordinatesAsString,
  hasAdditionalCoordinates,
} from "oxalis/model/accessors/flycam_accessor";
import { getVolumeTracingById } from "oxalis/model/accessors/volumetracing_accessor";
import { getBoundingBoxInMag1 } from "oxalis/model/sagas/volume/helpers";
import { voxelToVolumeInUnit } from "oxalis/model/scaleinfo";
import { api } from "oxalis/singletons";
import type { Segment, WebknossosState } from "oxalis/store";
import { useSelector } from "react-redux";
import type { APISegmentationLayer, VoxelSize } from "types/api_types";
import {
  type SegmentHierarchyGroup,
  type SegmentHierarchyNode,
  getVolumeRequestUrl,
} from "./segments_view_helper";

const MODAL_ERROR_MESSAGE =
  "Segment statistics could not be fetched. Check the console for more details.";
const CONSOLE_ERROR_MESSAGE =
  "Segment statistics could not be fetched due to the following reason:";

const getSegmentStatisticsCSVHeader = (dataSourceUnit: string) =>
  `segmendId,segmentName,groupId,groupName,volumeInVoxel,volumeIn${dataSourceUnit}3,boundingBoxTopLeftPositionX,boundingBoxTopLeftPositionY,boundingBoxTopLeftPositionZ,boundingBoxSizeX,boundingBoxSizeY,boundingBoxSizeZ`;

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
  const segmentStatisticsAsString = segmentInformation
    .map((row) => {
      const maybeAdditionalCoords = hasAdditionalCoords ? [row.additionalCoordinates] : [];
      return transformToCSVRow([
        ...maybeAdditionalCoords,
        row.segmentId,
        row.segmentName,
        row.groupId,
        row.groupName,
        row.volumeInVoxel,
        row.volumeInUnit3,
        ...row.boundingBoxTopLeft,
        ...row.boundingBoxPosition,
      ]);
    })
    .join("\n");

  const csv_header = hasAdditionalCoords
    ? [ADDITIONAL_COORDS_COLUMN, getSegmentStatisticsCSVHeader(voxelSize.unit)].join(",")
    : getSegmentStatisticsCSVHeader(voxelSize.unit);
  const csv = [csv_header, segmentStatisticsAsString].join("\n");
  const filename =
    groupIdToExport === -1
      ? `segmentStatistics_${tracingIdOrDatasetName}.csv`
      : `segmentStatistics_${tracingIdOrDatasetName}_group-${groupIdToExport}.csv`;
  const blob = new Blob([csv], {
    type: "text/plain;charset=utf-8",
  });
  saveAs(blob, filename);
};

export function SegmentStatisticsModal({
  onCancel,
  tracingId,
  visibleSegmentationLayer,
  relevantSegments: segments,
  parentGroup,
  groupTree,
}: Props) {
  const { dataset, annotation, temporaryConfiguration } = useSelector(
    (state: WebknossosState) => state,
  );
  const magInfo = getMagInfo(visibleSegmentationLayer.resolutions);
  const layersFinestMag = magInfo.getFinestMag();
  const voxelSize = dataset.dataSource.scale;
  // Omit checking that all prerequisites for segment stats (such as a segment index) are
  // met right here because that should happen before opening the modal.
  const requestUrl = getVolumeRequestUrl(
    dataset,
    annotation,
    visibleSegmentationLayer.tracingId,
    visibleSegmentationLayer,
  );
  const additionalCoordinates = useSelector(
    (state: WebknossosState) => state.flycam.additionalCoordinates,
  );
  const hasAdditionalCoords = hasAdditionalCoordinates(additionalCoordinates);
  const additionalCoordinateStringForModal = getAdditionalCoordinatesAsString(
    additionalCoordinates,
    ", ",
  );
  const segmentStatisticsObjects = useFetch(
    async () => {
      await api.tracing.save();
      if (requestUrl == null) return;
      const maybeVolumeTracing =
        tracingId != null ? getVolumeTracingById(annotation, tracingId) : null;
      const maybeGetMappingName = () => {
        if (maybeVolumeTracing?.mappingName != null) return maybeVolumeTracing.mappingName;
        const mappingInfo = getMappingInfo(
          temporaryConfiguration.activeMappingByLayer,
          visibleSegmentationLayer?.name,
        );
        return mappingInfo.mappingName;
      };
      const segmentStatisticsObjects = await Promise.all([
        getSegmentVolumes(
          requestUrl,
          layersFinestMag,
          segments.map((segment) => segment.id),
          additionalCoordinates,
          maybeGetMappingName(),
        ),
        getSegmentBoundingBoxes(
          requestUrl,
          layersFinestMag,
          segments.map((segment) => segment.id),
          additionalCoordinates,
          maybeGetMappingName(),
        ),
      ]).then(
        (response) => {
          const segmentSizes = response[0];
          const boundingBoxes = response[1];
          const statisticsObjects = [];
          const additionalCoordStringForCsv =
            getAdditionalCoordinatesAsString(additionalCoordinates);
          for (let i = 0; i < segments.length; i++) {
            // Segments in request and their statistics in the response are in the same order
            const currentSegment = segments[i];
            const currentBoundingBox = boundingBoxes[i];
            const boundingBoxInMag1 = getBoundingBoxInMag1(currentBoundingBox, layersFinestMag);
            const currentSegmentSizeInVx = segmentSizes[i];
            const volumeInUnit3 = voxelToVolumeInUnit(
              voxelSize,
              layersFinestMag,
              currentSegmentSizeInVx,
            );
            const currentGroupId = getGroupIdForSegment(currentSegment);
            const segmentStateObject: SegmentInfo = {
              key: currentSegment.id,
              additionalCoordinates: additionalCoordStringForCsv,
              segmentId: currentSegment.id,
              segmentName:
                currentSegment.name == null ? `Segment ${currentSegment.id}` : currentSegment.name,
              groupId: currentGroupId,
              groupName: getGroupNameForId(currentGroupId),
              volumeInVoxel: currentSegmentSizeInVx,
              volumeInUnit3: volumeInUnit3,
              formattedSize: formatNumberToVolume(
                volumeInUnit3,
                LongUnitToShortUnitMap[voxelSize.unit],
              ),
              boundingBoxTopLeft: boundingBoxInMag1.topLeft,
              boundingBoxTopLeftAsString: `(${boundingBoxInMag1.topLeft.join(", ")})`,
              boundingBoxPosition: [
                boundingBoxInMag1.width,
                boundingBoxInMag1.height,
                boundingBoxInMag1.depth,
              ] as Vector3,
              boundingBoxPositionAsString: `(${boundingBoxInMag1.width}, ${boundingBoxInMag1.height}, ${boundingBoxInMag1.depth})`,
            };
            statisticsObjects.push(segmentStateObject);
          }
          return statisticsObjects;
        },
        (error) => {
          console.log(CONSOLE_ERROR_MESSAGE, error);
          return null;
        },
      );
      return segmentStatisticsObjects;
    },
    [],
    [],
  );
  const columns = [
    { title: "Segment ID", dataIndex: "segmentId", key: "segmentId" },
    { title: "Segment Name", dataIndex: "segmentName", key: "segmentName" },
    { title: "Volume", dataIndex: "formattedSize", key: "formattedSize" },
    {
      title: "Bounding Box\nTop Left Position",
      dataIndex: "boundingBoxTopLeftAsString",
      key: "boundingBoxTopLeft",
      width: 150,
    },
    {
      title: "Bounding Box\nSize in vx",
      dataIndex: "boundingBoxPositionAsString",
      key: "boundingBoxPosition",
      width: 150,
    },
  ];

  const getGroupIdForSegment = (segment: Segment) => {
    if (segment.groupId != null) return segment.groupId;
    const rootGroup = groupTree.find(
      (node) => node.type === "group" && node.id === -1,
    ) as SegmentHierarchyGroup | null;
    if (rootGroup?.children.find((node: SegmentHierarchyNode) => node.id === segment.id)) {
      return -1;
    } else {
      return null;
    }
  };

  const getGroupNameForId = (groupId: number | null) => {
    if (groupId == null) return "";
    if (groupId === -1) return "root";
    const potentialGroupNode = groupTree.find(
      (node) => node.type === "group" && node.id === groupId,
    );
    return potentialGroupNode?.name == null ? "" : potentialGroupNode.name;
  };

  const isErrorCase = segmentStatisticsObjects == null;

  return (
    <Modal
      open
      title="Segment Statistics"
      onCancel={onCancel}
      width={700}
      onOk={() =>
        !isErrorCase &&
        exportStatisticsToCSV(
          segmentStatisticsObjects,
          tracingId || dataset.name,
          parentGroup,
          hasAdditionalCoords,
          voxelSize,
        )
      }
      okText="Export to CSV"
      okButtonProps={{ disabled: isErrorCase }}
    >
      <Spin spinning={segmentStatisticsObjects?.length === 0 && segments.length > 0}>
        {isErrorCase ? (
          MODAL_ERROR_MESSAGE
        ) : (
          <>
            {hasAdditionalCoords && (
              <Alert
                message={`These statistics only refer to the current additional ${pluralize(
                  "coordinate",
                  additionalCoordinates?.length || 0,
                )} ${additionalCoordinateStringForModal}.`}
                type="info"
                showIcon
              />
            )}
            <Table
              dataSource={segmentStatisticsObjects}
              columns={columns}
              style={{ whiteSpace: "pre" }}
            />
          </>
        )}
      </Spin>
    </Modal>
  );
}
