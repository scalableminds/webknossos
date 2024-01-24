import { getSegmentBoundingBoxes, getSegmentVolumes } from "admin/admin_rest_api";
import { Alert, Modal, Spin, Table } from "antd";
import saveAs from "file-saver";
import { formatNumberToVolume } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { Vector3 } from "oxalis/constants";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { OxalisState, Segment } from "oxalis/store";
import React from "react";
import { SegmentHierarchyNode, SegmentHierarchyGroup } from "./segments_view_helper";
import { api } from "oxalis/singletons";
import { APISegmentationLayer } from "types/api_flow_types";
import { voxelToNm3 } from "oxalis/model/scaleinfo";
import { getBoundingBoxInMag1 } from "oxalis/model/sagas/volume/helpers";
import { useSelector } from "react-redux";
import {
  getAdditionalCoordinatesAsString,
  hasAdditionalCoordinates,
} from "oxalis/model/accessors/flycam_accessor";
import { pluralize } from "libs/utils";

const MODAL_ERROR_MESSAGE =
  "Segment statistics could not be fetched. Check the console for more details.";
const CONSOLE_ERROR_MESSAGE =
  "Segment statistics could not be fetched due to the following reason:";

const SEGMENT_STATISTICS_CSV_HEADER =
  "segmendId,segmentName,groupId,groupName,volumeInVoxel,volumeInNm3,boundingBoxTopLeftPositionX,boundingBoxTopLeftPositionY,boundingBoxTopLeftPositionZ,boundingBoxSizeX,boundingBoxSizeY,boundingBoxSizeZ";

const ADDITIONAL_COORDS_COLUMN = "additionalCoordinates";

type Props = {
  onCancel: (...args: Array<any>) => any;
  tracingId: string;
  tracingStoreUrl: string;
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
  volumeInNm3: number;
  formattedSize: string;
  volumeInVoxel: number;
  boundingBoxTopLeft: Vector3;
  boundingBoxTopLeftAsString: string;
  boundingBoxPosition: Vector3;
  boundingBoxPositionAsString: string;
};

const exportStatisticsToCSV = (
  segmentInformation: Array<SegmentInfo> | null,
  tracingId: string,
  groupIdToExport: number,
  hasAdditionalCoords: boolean,
) => {
  const segmentStatisticsAsString = (segmentInformation as Array<SegmentInfo>)
    .map((row) => {
      const maybeAdditionalCoords = hasAdditionalCoords ? [row.additionalCoordinates] : [];
      const segmentInfoRow = [
        row.segmentId,
        row.segmentName,
        row.groupId,
        row.groupName,
        row.volumeInVoxel,
        row.volumeInNm3,
        ...row.boundingBoxTopLeft,
        ...row.boundingBoxPosition,
      ]
        .map(String) // convert every value to String
        .map((v) => v.replaceAll('"', '""')) // escape double quotes
        .map((v) => (v.includes(",") || v.includes('"') ? `"${v}"` : v)); // quote it if necessary
      return maybeAdditionalCoords.concat(segmentInfoRow).join(",");
    })
    .join("\n"); // rows starting on new lines

  const csv_header = hasAdditionalCoords
    ? [ADDITIONAL_COORDS_COLUMN, SEGMENT_STATISTICS_CSV_HEADER].join(",")
    : SEGMENT_STATISTICS_CSV_HEADER;
  const csv = [csv_header, segmentStatisticsAsString].join("\n");
  const filename =
    groupIdToExport === -1
      ? `segmentStatistics_tracing-${tracingId}.csv`
      : `segmentStatistics_tracing-${tracingId}_group-${groupIdToExport}.csv`;
  const blob = new Blob([csv], {
    type: "text/plain;charset=utf-8",
  });
  saveAs(blob, filename);
};

export function SegmentStatisticsModal({
  onCancel,
  tracingId,
  tracingStoreUrl,
  visibleSegmentationLayer,
  relevantSegments: segments,
  parentGroup,
  groupTree,
}: Props) {
  const magInfo = getResolutionInfo(visibleSegmentationLayer.resolutions);
  const layersFinestResolution = magInfo.getFinestResolution();
  const dataSetScale = useSelector((state: OxalisState) => state.dataset.dataSource.scale);
  const additionalCoordinates = useSelector(
    (state: OxalisState) => state.flycam.additionalCoordinates,
  );
  const hasAdditionalCoords = hasAdditionalCoordinates(additionalCoordinates);
  const additionalCoordinateStringForModal = getAdditionalCoordinatesAsString(
    additionalCoordinates,
    ", ",
  );
  const segmentStatisticsObjects = useFetch(
    async () => {
      await api.tracing.save();
      const segmentStatisticsObjects: Array<SegmentInfo> | null = await Promise.all([
        getSegmentVolumes(
          tracingStoreUrl,
          tracingId,
          layersFinestResolution,
          segments.map((segment) => segment.id),
          additionalCoordinates,
        ),
        getSegmentBoundingBoxes(
          tracingStoreUrl,
          tracingId,
          layersFinestResolution,
          segments.map((segment) => segment.id),
          additionalCoordinates,
        ),
      ]).then(
        (response) => {
          const segmentSizes = response[0];
          const boundingBoxes = response[1];
          const statisticsObjects = [];
          const additionalCoordStringForCsv =
            getAdditionalCoordinatesAsString(additionalCoordinates);
          for (let i = 0; i < segments.length; i++) {
            // segments in request and their statistics in the response are in the same order
            const currentSegment = segments[i];
            const currentBoundingBox = boundingBoxes[i];
            const boundingBoxInMag1 = getBoundingBoxInMag1(
              currentBoundingBox,
              layersFinestResolution,
            );
            const currentSegmentSizeInVx = segmentSizes[i];
            const volumeInNm3 = voxelToNm3(
              dataSetScale,
              layersFinestResolution,
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
              volumeInNm3,
              formattedSize: formatNumberToVolume(volumeInNm3),
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
        exportStatisticsToCSV(segmentStatisticsObjects, tracingId, parentGroup, hasAdditionalCoords)
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
                className="segments-stats-info-alert"
                message={`These statistics only refer to the current additional ${pluralize(
                  "coordinate",
                  additionalCoordinates?.length || 0,
                )} ${additionalCoordinateStringForModal}.`}
                type="info"
                showIcon
              />
            )}
            <Table
              dataSource={segmentStatisticsObjects as Array<SegmentInfo>}
              columns={columns}
              style={{ whiteSpace: "pre" }}
            />
          </>
        )}
      </Spin>
    </Modal>
  );
}
