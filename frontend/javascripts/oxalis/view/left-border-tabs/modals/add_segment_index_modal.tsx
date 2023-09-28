import { Alert, Modal } from "antd";
import React, { useState } from "react";
import { AsyncButton } from "components/async_clickables";
import type { VolumeTracing } from "oxalis/store";
import { api } from "oxalis/singletons";

export default function AddSegmentIndexModal({
  volumeLayerName,
  volumeTracing,
  hideAddSegmentIndexModal,
}: {
  volumeLayerName: string;
  volumeTracing: VolumeTracing;
  hideAddSegmentIndexModal: () => void;
}) {
  const [isCalculatingSegmentIndex, setIsCalculatingSegmentIndex] = useState(false);

  const handleCalculateSegmentIndex = async () => {
    setIsCalculatingSegmentIndex(true);
    await api.tracing.addSegmentIndex(volumeTracing.tracingId);
    setIsCalculatingSegmentIndex(false);
  };

  return (
    <Modal
      title="Add segment index to this layer"
      onCancel={isCalculatingSegmentIndex ? undefined : hideAddSegmentIndexModal}
      footer={null}
      width={800}
      maskClosable={false}
      open
    >
      <p>
        This will calculate the segment index for the volume annotation layer "{volumeLayerName}".
        This enables certain features, such as computing segment statistics. This operation only has
        to be performed once and is done automatically for new annotations. This will take a while
        and editing will be disabled during this time. Once finished the annotation reloads.
      </p>

      <Alert
        style={{
          fontWeight: "bold",
        }}
        message="Note that this action might take a few minutes. Afterwards, the annotation is reloaded.
        Also, the version history of the volume data will be reset."
        type="warning"
      />
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: 12,
        }}
      >
        <AsyncButton onClick={handleCalculateSegmentIndex} type="primary">
          Calculate Segment Index
        </AsyncButton>
      </div>
    </Modal>
  );
}
