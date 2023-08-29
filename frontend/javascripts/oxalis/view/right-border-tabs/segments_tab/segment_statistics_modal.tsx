import { getSegmentBoundingBoxes, getSegmentVolumes } from "admin/admin_rest_api";
import { Modal, Table } from "antd";
import saveAs from "file-saver";
import { formatNumberToUnit, formatNumberToVolume } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { Unicode } from "oxalis/constants";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { Segment } from "oxalis/store";
import React from "react";
import resolutions from "test/fixtures/resolutions";

const SEGMENT_STATISTICS_CSV_HEADER = "groupId,segmendId,segmentName,volumeInVoxel,volumeInNm3";

const { ThinSpace } = Unicode;

type Props = {
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
  tracingId: any;
  tracingStoreUrl: any;
  visibleSegmentationLayer: any;
  segments: Segment[];
  parentGroup: number;
};

type SegmentInfo = {
  segmentId: number;
  segmentName: string;
  groupId: number | undefined | null;
  //groupName: string; TODO
  volumeInNm3: number;
  formattedSize: string;
  volumeInVoxel: number;
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
        `${segmentInfo.groupId},${segmentInfo.segmentId},${segmentInfo.segmentName},${segmentInfo.volumeInVoxel},${segmentInfo.volumeInNm3}`,
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
  segments,
  parentGroup,
}: Props) {
  const mag = getResolutionInfo(visibleSegmentationLayer.resolutions);
  const nmFactorToUnit = new Map([[1, "nm³"]]);
  const dataSource = useFetch(
    async () => {
      //simply returns an array of the sizes
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
          // segments in request and their statistics in response are in same order
          const currentSegment = segments[i];
          const segmentStatObject = {
            segmentId: currentSegment.id,
            segmentName:
              currentSegment.name == null ? `Segment ${currentSegment.id}` : currentSegment.name,
            groupId: currentSegment.groupId == null ? -1 : currentSegment.groupId,
            // TODO groupName:
            volumeInVoxel: segmentSizes[i],
            volumeInNm3: parseInt(
              formatNumberToUnit(segmentSizes[i], nmFactorToUnit).split(ThinSpace)[0],
            ),
            formattedSize: formatNumberToVolume(segmentSizes[i]),
            boundingBox: boundingBoxes[i],
          };
          statisticsObjects.push(segmentStatObject);
        }
        return statisticsObjects;
      });
      return resultObjects;
    },
    [], //TODO make pretty with spinner
    [isOpen],
  );
  const columns = [
    { title: "Segment", dataIndex: "segmentName", key: "segmentName" },
    { title: "Volume", dataIndex: "formattedSize", key: "formattedSize" },
    { title: "Boundingbox", dataIndex: "boundingBox", key: "boundingBox" },
  ];

  return (
    <Modal
      title="Segment Statistics"
      open={isOpen}
      onCancel={onCancel}
      style={{ marginRight: 10 }}
      onOk={() => exportStatisticsToCSV(dataSource, tracingId, parentGroup)}
      okText="Export to CSV"
    >
      <Table dataSource={dataSource} columns={columns} />
    </Modal>
  );
}
