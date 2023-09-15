import { getSegmentBoundingBoxes, getSegmentVolumes } from "admin/admin_rest_api";
import { Modal, Spin, Table } from "antd";
import saveAs from "file-saver";
import { formatNumberToVolume } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { Vector3 } from "oxalis/constants";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { Segment } from "oxalis/store";
import React from "react";
import { SegmentHierarchyNode, SegmentHierarchyGroup } from "./segments_view_helper";
import { Store, api } from "oxalis/singletons";
import { APISegmentationLayer } from "types/api_flow_types";
import { getBaseVoxel } from "oxalis/model/scaleinfo";

const SEGMENT_STATISTICS_CSV_HEADER =
  "segmendId,segmentName,groupId,groupName,volumeInVoxel,volumeInNm3,boundingBoxTopLeftPositionX,boundingBoxTopLeftPositionY,boundingBoxTopLeftPositionZ,boundingBoxSizeX,boundingBoxSizeY,boundingBoxSizeZ";

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
  segmentId: number;
  segmentName: string;
  groupId: number | undefined | null;
  groupName: string;
  volumeInNm3: number;
  formattedSize: string;
  volumeInVoxel: number;
  boundingBoxTopLeft: Vector3;
  boundingBoxPosition: Vector3;
};

const exportStatisticsToCSV = (
  segmentInformation: Array<SegmentInfo>,
  tracingId: string,
  groupIdToExport: number,
) => {
  if (segmentInformation.length === 0) {
    return;
  }
  const segmentStatisticsAsString = segmentInformation
    .map(
      (row) =>
        [
          row.segmentId,
          row.segmentName,
          row.groupId,
          row.groupName,
          row.volumeInVoxel,
          row.volumeInNm3,
          row.boundingBoxTopLeft,
          row.boundingBoxPosition,
        ]
          .map(String) // convert every value to String
          .map((v) => v.replaceAll('"', '""')) // escape double quotes
          .map((v) => (v.includes(",") || v.includes('"') ? `"${v}"` : v)) // quote it if necessary
          .join(","), // comma-separated
    )
    .join("\n"); // rows starting on new lines
  const csv = [SEGMENT_STATISTICS_CSV_HEADER, segmentStatisticsAsString].join("\n");
  const filename = `segmentStatistics_tracing-${tracingId}_group-${groupIdToExport}.csv`;
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
  const mag = getResolutionInfo(visibleSegmentationLayer.resolutions);
  const scaleFactor = getBaseVoxel(Store.getState().dataset.dataSource.scale);
  const dataSource = useFetch(
    async () => {
      await api.tracing.save();
      const segmentStatisticsObjects = await Promise.all([
        getSegmentVolumes(
          tracingStoreUrl,
          tracingId,
          mag.getHighestResolution(),
          segments.map((segment) => segment.id),
        ),
        getSegmentBoundingBoxes(
          tracingStoreUrl,
          tracingId,
          mag.getHighestResolution(),
          segments.map((segment) => segment.id),
        ),
      ]).then((response) => {
        const segmentSizes = response[0];
        const boundingBoxes = response[1];
        const statisticsObjects = [];
        for (let i = 0; i < segments.length; i++) {
          // segments in request and their statistics in the response are in the same order
          const currentSegment = segments[i];
          const currentBoundingBox = boundingBoxes[i];
          const currentSegmentSizeInVx = segmentSizes[i];
          const volumeInNm3 = currentSegmentSizeInVx * scaleFactor;
          const currentGroupId = getGroupIdForSegment(currentSegment);
          const segmentStatObject = {
            key: currentSegment.id,
            segmentId: currentSegment.id,
            segmentName:
              currentSegment.name == null ? `Segment ${currentSegment.id}` : currentSegment.name,
            groupId: currentGroupId,
            groupName: getGroupNameForId(currentGroupId),
            volumeInVoxel: currentSegmentSizeInVx,
            volumeInNm3,
            formattedSize: formatNumberToVolume(volumeInNm3),
            boundingBoxTopLeft: currentBoundingBox.topLeft,
            boundingBoxTopLeftAsString: `(${currentBoundingBox.topLeft.join(", ")})`,
            boundingBoxPosition: [
              currentBoundingBox.width,
              currentBoundingBox.height,
              currentBoundingBox.depth,
            ] as Vector3,
            boundingBoxPositionAsString: `(${currentBoundingBox.width}, ${currentBoundingBox.height}, ${currentBoundingBox.depth})`,
          };
          statisticsObjects.push(segmentStatObject);
        }
        return statisticsObjects;
      });
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

  return (
    <Modal
      open
      title="Segment Statistics"
      onCancel={onCancel}
      style={{ marginRight: 10 }}
      width={700}
      onOk={() => exportStatisticsToCSV(dataSource, tracingId, parentGroup)}
      okText="Export to CSV"
    >
      <Spin spinning={dataSource.length === 0}>
        <Table dataSource={dataSource} columns={columns} style={{ whiteSpace: "pre" }} />
      </Spin>
    </Modal>
  );
}
