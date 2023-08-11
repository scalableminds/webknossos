import { getSegmentVolume } from "admin/admin_rest_api";
import { Button, Modal, Table } from "antd";
import { formatNumberToVolume } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { Segment } from "oxalis/store";
import React from "react";

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
  //TODO remove?
  segmentId: number;
  segmentName: string;
  groupId: number;
  groupName: string;
  sizeInNm: number;
};

const exportStatisticsToCSV = () => {
  console.log();
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
  console.log(tracingId);
  const mag = getResolutionInfo(visibleSegmentationLayer.resolutions);
  const dataSource = useFetch(
    async () => {
      const volumeStrings = await segments.map(async (segment: Segment) => {
        return getSegmentVolume(
          tracingStoreUrl,
          tracingId,
          mag.getHighestResolution(),
          segment.id,
        ).then((vol) => {
          return {
            segmentId: segment.id,
            segmentName: segment.name == null ? `Segment ${segment.id}` : segment.id,
            groupId: group,
            sizeInNm: vol,
            formattedSize: formatNumberToVolume(vol),
          };
        });
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
      onOk={() => exportStatisticsToCSV()}
      okText="Export to CSV"
    >
      <Table dataSource={dataSource} columns={columns} />
    </Modal>
  );
}
