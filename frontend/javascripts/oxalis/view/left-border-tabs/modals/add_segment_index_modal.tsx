import { Modal } from "antd";
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
      // @ts-expect-error ts-migrate(2322) FIXME: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
      onCancel={isCalculatingSegmentIndex ? null : hideAddSegmentIndexModal}
      footer={null}
      width={800}
      maskClosable={false}
      open
    >
      <p>
        This will calculate the segment index for the volume annotation layer {volumeLayerName}.
        This will take a while and editing will be disabled during this time. Once finished the
        annotation reloads.
      </p>

      <p
        style={{
          fontWeight: "bold",
        }}
      >
        Note that this action might take a few minutes. Afterwards, the annotation is reloaded.
        Also, the version history of the volume data will be reset.
      </p>
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
