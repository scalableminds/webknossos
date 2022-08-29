import * as React from "react";
import { Button, Modal, InputNumber } from "antd";
import { useDispatch } from "react-redux";
import {
  createCellAction,
  setLargestSegmentIdAction,
} from "oxalis/model/actions/volumetracing_actions";
import renderIndependently from "libs/render_independently";
import Toast from "libs/toast";

const TOAST_KEY = "enter-largest-segment-id";

export function showToastWarningForLargestSegmentIdMissing() {
  const openEnterLargestSegmentIdModal = () => {
    renderIndependently((destroy) => <EnterLargestSegmentIdModal destroy={destroy} />);
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
  destroy,
}: {
  destroy: (...args: Array<any>) => any;
}) {
  const [largestSegmentId, setLargestSegmentId] = React.useState(0);
  const dispatch = useDispatch();
  const handleOk = () => {
    if (largestSegmentId < 1) {
      Toast.warning("Please enter a segment id greater than 0.");
      return;
    }
    dispatch(setLargestSegmentIdAction(largestSegmentId));
    dispatch(createCellAction(largestSegmentId));
    Toast.close(TOAST_KEY);
    destroy();
  };
  const handleCancel = () => {
    destroy();
  };

  return (
    <Modal visible title="Enter Largest Segment ID" onOk={handleOk} onCancel={handleCancel}>
      <p>
        No largest segment ID was configured for this dataset layer. This means that webKnossos does
        not know which segment ID would be safe to use for annotating new segments (because it is
        not in use yet).
      </p>

      <p>
        If you know the largest segment ID in this segmentation layer or if you know which value
        would be safe to use, please input it below:
      </p>
      <div style={{ display: "grid", placeItems: "center" }}>
        <InputNumber
          size="large"
          min={1}
          max={100000}
          value={largestSegmentId}
          onChange={setLargestSegmentId}
        />
      </div>
    </Modal>
  );
}
