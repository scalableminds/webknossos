import { Modal } from "antd";
import { Vector3 } from "oxalis/constants";
import {
  getMappingInfo,
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
  visibleSegmentationLayer: any;
  tracingId: any;
  tracingStoreUrl: any;
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
  segmentIds,
}: Props) {
  console.log(tracingId);
  /*   const segmentSize = useFetch(
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
  ); */

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
