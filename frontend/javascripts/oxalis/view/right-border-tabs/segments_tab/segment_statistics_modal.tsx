import { getSegmentVolume } from "admin/admin_rest_api";
import { Modal, Table } from "antd";
import saveAs from "file-saver";
import { formatNumberToUnit, formatNumberToVolume } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { Unicode } from "oxalis/constants";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { Segment } from "oxalis/store";
import React from "react";

const SEGMENT_STATISTICS_CSV_HEADER = "groupId,segmendId,segmentName,volumeInVoxel,volumeInNm3";

const { ThinSpace } = Unicode;

type Props = {
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
  tracingId: any;
  tracingStoreUrl: any;
  visibleSegmentationLayer: any;
  segments: Segment[];
  group: number;
};

type SegmentInfo = {
  segmentId: number;
  segmentName: string;
  groupId: number;
  //groupName: string; TODO
  volumeInNm3: number;
  formattedSize: string;
  volumeInVoxel: number;
};

const exportStatisticsToCSV = (segmentInformation: Array<SegmentInfo>) => {
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
  const filename = `segmentStatistics-${new Date().toLocaleString().replace(/s/, "-")}.csv`; // TODO useful file naming
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
  group,
}: Props) {
  const mag = getResolutionInfo(visibleSegmentationLayer.resolutions);
  const nmFactorToUnit = new Map([[1, "nm³"]]);
  const dataSource = useFetch(
    async () => {
      //simply returns an array of the sizes
      const volumeStrings = await getSegmentVolume(
        tracingStoreUrl,
        tracingId,
        mag.getHighestResolution(),
        segments.map((segment) => segment.id),
      ).then((response) => {
        console.log(response); //TODO continue here
        const formattedSize = formatNumberToVolume(response);
        return {
          segmentId: segment.id,
          segmentName: segment.name == null ? `Segment ${segment.id}` : segment.name,
          groupId: group, //TODO this doesnt work for nested segments yet
          volumeInVoxel: response,
          volumeInNm3: parseInt(formatNumberToUnit(response, nmFactorToUnit).split(ThinSpace)[0]),
          formattedSize: formattedSize,
        };
      });
      return Promise.all(volumeStrings);
    },
    [], //TODO make pretty with spinner
    [isOpen],
  );
  const columns = [
    { title: "Segment", dataIndex: "segmentName", key: "segmentName" },
    { title: "Volume", dataIndex: "formattedSize", key: "formattedSize" },
  ];

  return (
    <Modal
      title="Segment Statistics"
      open={isOpen}
      onCancel={onCancel}
      style={{ marginRight: 10 }}
      onOk={() => exportStatisticsToCSV(dataSource)}
      okText="Export to CSV"
    >
      <Table dataSource={dataSource} columns={columns} />
    </Modal>
  );
}
