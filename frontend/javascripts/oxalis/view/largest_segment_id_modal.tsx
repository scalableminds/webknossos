import * as React from "react";
import { Button, Modal, InputNumber } from "antd";
import { useDispatch, useSelector } from "react-redux";
import {
  createCellAction,
  setLargestSegmentIdAction,
} from "oxalis/model/actions/volumetracing_actions";
import renderIndependently from "libs/render_independently";
import Toast from "libs/toast";
import Store from "oxalis/throttled_store";
import type { OxalisState, VolumeTracing } from "oxalis/store";
import { mayUserEditDataset } from "libs/utils";
import { getBitDepth, getReadableURLPart } from "oxalis/model/accessors/dataset_accessor";
import {
  getSegmentationLayerForTracing,
  getVolumeTracingByLayerName,
} from "oxalis/model/accessors/volumetracing_accessor";
import type { APISegmentationLayer } from "types/api_flow_types";

const TOAST_KEY = "enter-largest-segment-id";

export function showToastWarningForLargestSegmentIdMissing(volumeTracing: VolumeTracing) {
  const segmentationLayer = getSegmentationLayerForTracing(Store.getState(), volumeTracing);
  const openEnterLargestSegmentIdModal = () => {
    renderIndependently((destroy) => (
      <EnterLargestSegmentIdModal segmentationLayer={segmentationLayer} destroy={destroy} />
    ));
  };
  Toast.warning(
    <div>
      Cannot create a new segment id, because the largest segment id is not known.
      <div>
        <Button
          type="primary"
          style={{ marginTop: 8, marginLeft: 8 }}
          onClick={openEnterLargestSegmentIdModal}
        >
          Enter largest segment id
        </Button>
      </div>
    </div>,
    { key: TOAST_KEY },
  );
}

export default function EnterLargestSegmentIdModal({
  segmentationLayer,
  destroy,
}: {
  segmentationLayer: APISegmentationLayer;
  destroy: (...args: Array<any>) => any;
}) {
  const [largestSegmentId, setLargestSegmentId] = React.useState<number | null>(0);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const activeCellId =
    useSelector(
      (state: OxalisState) =>
        getVolumeTracingByLayerName(state.tracing, segmentationLayer.name)?.activeCellId,
    ) || 0;

  const dispatch = useDispatch();
  const handleOk = () => {
    if (largestSegmentId == null || largestSegmentId < 1) {
      Toast.warning("Please enter a segment id greater than 0.");
      return;
    }
    dispatch(setLargestSegmentIdAction(largestSegmentId));
    dispatch(createCellAction(activeCellId, largestSegmentId));
    Toast.close(TOAST_KEY);
    destroy();
  };
  const handleCancel = () => {
    destroy();
  };

  const editString = "edit the same property in the dataset";
  const editLinkOrText = mayUserEditDataset(activeUser, dataset) ? (
    <a href={`/datasets/${getReadableURLPart(dataset)}/edit`} target="_blank" rel="noreferrer">
      {editString}
    </a>
  ) : (
    editString
  );

  const maxValue = 2 ** getBitDepth(segmentationLayer);

  return (
    <Modal open title="Enter Largest Segment ID" onOk={handleOk} onCancel={handleCancel}>
      <p>
        No largest segment ID was configured for this segmentation layer. This means that WEBKNOSSOS
        does not know which segment ID would be safe to use for annotating new segments (because it
        was not used yet).
      </p>

      <p>
        If you know the largest segment ID in this segmentation layer or if you know which value
        would be safe to use, please input it below:
      </p>
      <div style={{ display: "grid", placeItems: "center" }}>
        <InputNumber
          size="large"
          min={1}
          max={maxValue}
          value={largestSegmentId}
          onChange={setLargestSegmentId}
        />
      </div>

      <p style={{ marginTop: 8 }}>
        Additionally, it is recommended to {editLinkOrText} or ask an administrator to do so.
      </p>
    </Modal>
  );
}
