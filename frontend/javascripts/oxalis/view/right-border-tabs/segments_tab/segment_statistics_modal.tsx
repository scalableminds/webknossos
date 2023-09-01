import { getSegmentBoundingBoxes, getSegmentVolumes } from "admin/admin_rest_api";
import { Modal, Spin, Table } from "antd";
import saveAs from "file-saver";
import { formatNumberToUnit, formatNumberToVolume } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { Unicode, Vector3 } from "oxalis/constants";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { Segment } from "oxalis/store";
import React from "react";
import { TreeNode } from "./segments_view_helper";

const SEGMENT_STATISTICS_CSV_HEADER =
  "segmendId,segmentName,groupId,groupName,volumeInVoxel,volumeInNm3,boundingBoxTopLeftPositionX,boundingBoxTopLeftPositionY,boundingBoxTopLeftPositionZ,boundingBoxSizeX,boundingBoxSizeY,boundingBoxSizeZ";

const { ThinSpace } = Unicode;

type Props = {
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
  tracingId: any;
  tracingStoreUrl: any;
  visibleSegmentationLayer: any;
  relevantSegments: Segment[]; //TODO obsolete
  parentGroup: number;
  groupTree: TreeNode[];
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
  groupId: number,
) => {
  if (segmentInformation.length < 0) {
    return;
  }
  const segmentStatisticsAsString = segmentInformation
    .map(
      (segmentInfo) =>
        `${segmentInfo.segmentId},${segmentInfo.segmentName},${segmentInfo.groupId},${segmentInfo.groupName},${segmentInfo.volumeInVoxel},${segmentInfo.volumeInNm3},${segmentInfo.boundingBoxTopLeft},${segmentInfo.boundingBoxPosition}`,
    )
    .join("\n");
  const csv = [SEGMENT_STATISTICS_CSV_HEADER, segmentStatisticsAsString].join("\n");
  const filename = `segmentStatistics_tracing-${tracingId}_group-${groupId}.csv`;
  const blob = new Blob([csv], {
    type: "text/plain;charset=utf-8",
  });
  saveAs(blob, filename);
};

export function SegmentStatisticsModal({
  isOpen,
  onCancel,
  tracingId,
  tracingStoreUrl,
  visibleSegmentationLayer,
  relevantSegments: segments,
  parentGroup,
  groupTree,
}: Props) {
  const mag = getResolutionInfo(visibleSegmentationLayer.resolutions);
  const nmFactorToUnit = new Map([[1, "nm³"]]);
  const dataSource = useFetch(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 10000)); //TODO delete; only for testing
      let resultObjects = await Promise.all([
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
          // segments in request and their statistics in response are in the same order
          const currentSegment = segments[i];
          const currentBoundingBox = boundingBoxes[i];
          const segmentStatObject = {
            segmentId: currentSegment.id,
            segmentName:
              currentSegment.name == null ? `Segment ${currentSegment.id}` : currentSegment.name,
            groupId: currentSegment.groupId == null ? -1 : currentSegment.groupId,
            groupName: getGroupNameForId(
              currentSegment.groupId == null ? -1 : currentSegment.groupId,
            ),
            volumeInVoxel: segmentSizes[i],
            volumeInNm3: parseInt(
              formatNumberToUnit(segmentSizes[i], nmFactorToUnit).split(ThinSpace)[0],
            ),
            formattedSize: formatNumberToVolume(segmentSizes[i]),
            boundingBoxTopLeft: currentBoundingBox.topLeft,
            boundingBoxTopLeftAsString: `(${currentBoundingBox.topLeft[0]}, ${currentBoundingBox.topLeft[1]}, ${currentBoundingBox.topLeft[2]}) `,
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
      return resultObjects;
    },
    [],
    [isOpen],
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

  const getGroupNameForId = (id: number) => {
    if (id === -1) return "root";
    const potentialGroupNode = groupTree.find((node) => node.type === "group" && node.id === id);
    console.log(`groupname:${potentialGroupNode?.name}`);
    return potentialGroupNode?.name == null ? "" : potentialGroupNode.name;
  };

  return (
    <Modal
      title="Segment Statistics"
      open={isOpen}
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
