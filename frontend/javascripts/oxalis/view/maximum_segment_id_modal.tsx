import * as React from "react";
import { Button, Modal, InputNumber } from "antd";
import { useDispatch } from "react-redux";
import {
  createCellAction,
  setLargestSegmentIdAction,
} from "oxalis/model/actions/volumetracing_actions";
import renderIndependently from "libs/render_independently";
import Toast from "libs/toast";

export function showToastWarningForMaximumSegmentIdMissing() {
  const openEnterMaximumSegmentIdModal = () => {
    renderIndependently((destroy) => <EnterMaximumSegmentIdModal destroy={destroy} />);
  };
  Toast.warning(
    <div>
      Cannot create a new segment id, because the maximum segment id is not known.
      <Button
        type="primary"
        style={{ marginTop: 8, marginLeft: 8 }}
        onClick={openEnterMaximumSegmentIdModal}
      >
        Enter maximum segment id
      </Button>
    </div>,
  );
}

export default function EnterMaximumSegmentIdModal({
  destroy,
}: {
  destroy: (...args: Array<any>) => any;
}) {
  const [maximumSegmentId, setMaximumSegmentId] = React.useState(0);
  const dispatch = useDispatch();
  const handleOk = () => {
    if (maximumSegmentId < 1) {
      Toast.warning("Please enter a segment id greater than 0.");
      return;
    }
    dispatch(setLargestSegmentIdAction(maximumSegmentId));
    dispatch(createCellAction(maximumSegmentId));
    destroy();
  };
  const handleCancel = () => {
    destroy();
  };

  return (
    <Modal visible title="Enter Maximum Segment ID" onOk={handleOk} onCancel={handleCancel}>
      <p>
        No maximum segment ID was configured for this dataset layer. This means that webKnossos does
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
          value={maximumSegmentId}
          onChange={setMaximumSegmentId}
        />
      </div>
    </Modal>
  );
}
