// @flow

import { Modal } from "antd";
import React, { useState } from "react";

import { AsyncButton } from "components/async_clickables";
import type { Vector3 } from "oxalis/constants";
import type { VolumeTracing } from "oxalis/store";
import api from "oxalis/api/internal_api";

export default function DownsampleVolumeModal({
  hideDownsampleVolumeModal,
  magsToDownsample,
  volumeTracing,
}: {
  hideDownsampleVolumeModal: () => void,
  magsToDownsample: Array<Vector3>,
  volumeTracing: VolumeTracing,
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
      onCancel={isDownsampling ? null : hideDownsampleVolumeModal}
      footer={null}
      width={800}
      maskClosable={false}
    >
      <p>
        This annotation does not have volume annotation data in all resolutions. Consequently,
        annotation data cannot be rendered at all zoom values. By clicking &quot;Downsample&quot;,
        webKnossos will use the best resolution of the volume data to create all dependent
        resolutions.
      </p>

      <p>
        The following resolutions will be added when clicking &quot;Downsample&quot;:{" "}
        {magsToDownsample.map(mag => mag.join("-")).join(", ")}.
      </p>

      <div>
        The cause for the missing resolutions can be one of the following:
        <ul>
          <li>
            The annotation was created before webKnossos supported multi-resolution volume tracings.
          </li>
          <li>An old annotation was uploaded which did not include all resolutions.</li>
          <li>The annotation was created in a task that was restricted to certain resolutions.</li>
          <li>The dataset was mutated to have more resolutions.</li>
        </ul>
      </div>

      <p style={{ fontWeight: "bold" }}>
        Note that this action might take a few minutes. Afterwards, the annotation is reloaded.
        Also, the version history of the volume data will be reset.
      </p>
      <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
        <AsyncButton onClick={handleTriggerDownsampling} type="primary">
          Downsample
        </AsyncButton>
      </div>
    </Modal>
  );
}
