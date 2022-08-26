import * as React from "react";
import { Modal, InputNumber } from "antd";
import { useDispatch } from "react-redux";
import { setMaxCellAction } from "oxalis/model/actions/volumetracing_actions";

export function EnterMaximumSegmentIdModal({ destroy }: { destroy: (...args: Array<any>) => any }) {
  const [maximumSegmentId, setMaximumSegmentId] = React.useState(0);
  const dispatch = useDispatch();
  const handleOk = () => {
    dispatch(setMaxCellAction(maximumSegmentId));
    destroy();
  };
  const handleCancel = () => {
    destroy();
  };

  return (
    <Modal visible title="Enter Maximum Segment ID" onOk={handleOk} onCancel={handleCancel}>
      <p>
        No maximum segment ID was configured for this dataset layer. This means that webKnossos does
        not know which segment ID would be safe (because it was not used yet) to use for annotating
        new segments.
      </p>

      <p>
        If you know the largest segment ID in this segmentation layer or if you know which ID would
        be safe to use, please input it below:
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
