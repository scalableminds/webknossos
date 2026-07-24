import { Button, InputNumber, Modal } from "antd";
import { useWkSelector } from "libs/react_hooks";
import renderIndependently from "libs/render_independently";
import Toast from "libs/toast";
import { mayUserEditDataset } from "libs/utils";
import { useState } from "react";
import { useDispatch } from "react-redux";
import type { APISegmentationLayer } from "types/api_types";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import {
  getSegmentationLayerForTracing,
  getVolumeTracingByLayerName,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  createCellAction,
  setLargestSegmentIdAction,
} from "viewer/model/actions/volumetracing_actions";
import { getSegmentIdRangeForElementClass } from "viewer/model/bucket_data_handling/data_rendering_logic";
import type { VolumeTracing } from "viewer/store";
import Store from "viewer/throttled_store";

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

function EnterLargestSegmentIdModal({
  segmentationLayer,
  destroy,
}: {
  segmentationLayer: APISegmentationLayer;
  destroy: (...args: Array<any>) => any;
}) {
  const [largestSegmentId, setLargestSegmentId] = useState<bigint | null>(0n);
  const activeUser = useWkSelector((state) => state.activeUser);
  const dataset = useWkSelector((state) => state.dataset);
  const activeCellId =
    useWkSelector(
      (state) =>
        getVolumeTracingByLayerName(state.annotation, segmentationLayer.name)?.activeCellId,
    ) || 0n;

  const dispatch = useDispatch();
  const handleOk = () => {
    if (largestSegmentId == null || largestSegmentId === 0n) {
      // 0 is never a valid segment id (it represents empty data / the eraser). Any other value in
      // the element class's range is allowed, including negative ids for signed (int64) layers.
      Toast.warning("Please enter a segment id other than 0.");
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

  const [minValue, maxValue] = getSegmentIdRangeForElementClass(segmentationLayer.elementClass);

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
          stringMode
          precision={0}
          min={minValue.toString()}
          max={maxValue.toString()}
          value={largestSegmentId != null ? largestSegmentId.toString() : null}
          onChange={(val) => {
            if (val == null || val === "") {
              setLargestSegmentId(null);
              return;
            }
            try {
              setLargestSegmentId(BigInt(val));
            } catch {
              // Ignore intermediate, non-integer input while the user is still typing.
            }
          }}
        />
      </div>

      <p style={{ marginTop: 8 }}>
        Additionally, it is recommended to {editLinkOrText} or ask an administrator to do so.
      </p>
    </Modal>
  );
}
