import { getSegmentVolume } from "admin/admin_rest_api";
import { Modal } from "antd";
import { formatNumberToVolume } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { Vector3 } from "oxalis/constants";
import {
  getMappingInfo,
  getResolutionInfo,
  getVisibleSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { maybeGetSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import {
  getActiveSegmentationTracing,
  getSegmentsForLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import { Store } from "oxalis/singletons";
import { OxalisState, SegmentMap, SkeletonTracing, VolumeTracing } from "oxalis/store";
import React from "react";
import { connect } from "react-redux";
import { APIDataLayer } from "types/api_flow_types";

type Props = {
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
  tracingId: any;
  tracingStoreUrl: any;
  visibleSegmentationLayer: any;
  segmentIds: any;
};

const exportStatisticsToCSV = () => {
  console.log();
};

//for multiple segments I will probably need to make an array of objects of tracingIds, StoreUrls, and segmentIds
// TODO what does the tracing url depend on? -> I think its unique and needs to be passed every time

export function SegmentStatisticsModal({
  isOpen,
  onCancel,
  tracingId,
  tracingStoreUrl,
  visibleSegmentationLayer,
  segmentIds,
}: Props) {
  console.log(tracingId);
  const mag = getResolutionInfo(visibleSegmentationLayer.resolutions);
  const segmentSizesArray = useFetch(
    async () => {
      const volumeStrings = await segmentIds.map(async (segmentId: number) => {
        return getSegmentVolume(
          tracingStoreUrl,
          tracingId,
          mag.getHighestResolution(),
          segmentId,
        ).then((vol) => formatNumberToVolume(vol));
      });
      return Promise.all(volumeStrings);
    },
    ["loading"], //TODO make pretty with spinner
    [isOpen],
  );
  const segmentSizes = segmentSizesArray.join(",");
  console.log(segmentSizes);

  return (
    <Modal
      title="Segment Statistics"
      open={isOpen}
      onCancel={onCancel}
      style={{ marginRight: 10 }}
      onOk={exportStatisticsToCSV}
      okText="Export to CSV"
    >
      {segmentSizes}
    </Modal>
  );
}

/* function mapStateToProps(state: OxalisState): StateProps {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  return {
    volumeTracing: getActiveSegmentationTracing(state),
    datasetScale: state.dataset.dataSource.scale,
    visibleSegmentationLayer,
    segments:
      visibleSegmentationLayer != null
        ? getSegmentsForLayer(state, visibleSegmentationLayer.name)
        : null,
  };
}

const connector = connect(mapStateToProps);
export default connector(SegmentStatisticsModal); */
