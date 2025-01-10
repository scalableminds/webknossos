import { Modal } from "antd";
import { AsyncButton } from "components/async_clickables";
import type { Vector3 } from "oxalis/constants";
import { api } from "oxalis/singletons";
import type { VolumeTracing } from "oxalis/store";
import { useState } from "react";
export default function DownsampleVolumeModal({
  hideDownsampleVolumeModal,
  magsToDownsample,
  volumeTracing,
}: {
  hideDownsampleVolumeModal: () => void;
  magsToDownsample: Array<Vector3>;
  volumeTracing: VolumeTracing;
}) {
  const [isDownsampling, setIsDownsampling] = useState(false);

  const handleTriggerDownsampling = async () => {
    setIsDownsampling(true);
    await api.tracing.downsampleSegmentation(volumeTracing.tracingId);
    setIsDownsampling(false);
  };

  return (
    <Modal
      title="Downsample Volume Annotation"
      // @ts-expect-error ts-migrate(2322) FIXME: Type '(() => void) | null' is not assignable to ty... Remove this comment to see the full error message
      onCancel={isDownsampling ? null : hideDownsampleVolumeModal}
      footer={null}
      width={800}
      maskClosable={false}
      open
    >
      <p>
        This annotation does not have volume annotation data in all magnifications. Consequently,
        annotation data cannot be rendered at all zoom values. By clicking &quot;Downsample&quot;,
        WEBKNOSSOS will use the best magnification of the volume data to create all dependent mags.
      </p>
      <p>
        The following magnifications will be added when clicking &quot;Downsample&quot;:{" "}
        {magsToDownsample.map((mag) => mag.join("-")).join(", ")}.
      </p>
      <div>
        The cause for the missing magnifications can be one of the following:
        <ul>
          <li>
            The annotation was created before WEBKNOSSOS supported multi-magnification volume
            tracings.
          </li>
          <li>An old annotation was uploaded which did not include all magnifications.</li>
          <li>
            The annotation was created in a task that was restricted to certain magnifications.
          </li>
          <li>The dataset was mutated to have more magnifications.</li>
        </ul>
      </div>
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
        <AsyncButton onClick={handleTriggerDownsampling} type="primary">
          Downsample
        </AsyncButton>
      </div>
    </Modal>
  );
}
