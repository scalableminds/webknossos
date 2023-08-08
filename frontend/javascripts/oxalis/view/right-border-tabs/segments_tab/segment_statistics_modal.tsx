import { getSegmentVolume } from "admin/admin_rest_api";
import { Modal } from "antd";
import { formatNumberToVolume } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import React from "react";

type Props = {
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
  visibleSegmentationLayer;
  tracingId;
  tracingStoreUrl;
  segmentId;
};

const exportStatisticsToCSV = () => {
  console.log();
};

//for multiple segments I will probably need to make an array of objects of tracingIds, StoreUrls, and segmentIds
// TODO what does the tracing url depend on? -> I think its unique and needs to be passed every time

export function SegmentStatisticsModal({
  isOpen,
  onCancel,
  visibleSegmentationLayer,
  tracingId,
  tracingStoreUrl,
  segmentId,
}: Props) {
  const segmentSize = useFetch(
    async () => {
      const mag = getResolutionInfo(visibleSegmentationLayer.resolutions);
      const segmentSize = await getSegmentVolume(
        tracingStoreUrl,
        tracingId,
        mag.getHighestResolution(),
        segmentId,
      );
      console.log(segmentSize);
      return formatNumberToVolume(segmentSize);
    },
    "loading", //TODO make pretty with spinner
    [isOpen],
  );

  return (
    <Modal
      title="Segment Statistics"
      open={isOpen}
      onCancel={onCancel}
      footer={null}
      style={{ marginRight: 10 }}
      onOk={exportStatisticsToCSV}
    >
      <p>Hier könnte Ihre Größe stehen!</p>
    </Modal>
  );
}
