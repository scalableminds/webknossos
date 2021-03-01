// @flow
import { Button, Modal } from "antd";
import React, { useState } from "react";
import type { BoundingBoxType } from "oxalis/constants";
import type { APIDataset } from "types/api_flow_types";
import { startTiffExportJob } from "admin/admin_rest_api";
import features from "features";
import * as Utils from "libs/utils";

type Props = {
  destroy: () => void,
  dataset: APIDataset,
  boundingBox: BoundingBoxType,
};

const ExportBoundingBoxModal = ({ destroy, dataset, boundingBox }: Props) => {
  const [startedExports, setStartedExports] = useState([]);

  const handleClose = () => {
    destroy();
  };

  const handleStartExport = layerName => {
    startTiffExportJob(
      dataset.name,
      dataset.owningOrganization,
      layerName,
      Utils.computeArrayFromBoundingBox(boundingBox),
    );
    setStartedExports(startedExports.concat(layerName));
  };

  const layerNames = dataset.dataSource.dataLayers.map(layer => {
    const nameIfColor = layer.category === "color" ? layer.name : null;
    const nameIfVolume =
      layer.category === "segmentation" && layer.fallbackLayerInfo && layer.fallbackLayerInfo.name
        ? layer.fallbackLayerInfo.name
        : null;
    return nameIfColor || nameIfVolume;
  });

  const exportButtonsList = layerNames.map(layerName =>
    layerName ? (
      <p>
        <Button
          key={layerName}
          onClick={() => handleStartExport(layerName)}
          // disabled={startedExports.includes(layerName)} //TODO re-enable before merge, this is just to make development easier
        >
          {layerName}
          {startedExports.includes(layerName) ? " (started)" : null}
        </Button>
      </p>
    ) : null,
  );
  const dimensions = boundingBox.dimensions();
  const volume = boundingBox.volume();
  const volumeExceeded = volume > features().exportTiffMaxVolumeMVx * 1024 * 1024;
  const edgeLengthExceeded = dimensions.some((length) => length > features().exportTiffMaxEdgeLengthVx);
  const volumeExceededMessage = volumeExceeded ? <Alert type="warning" message={`The volume of the selected bounding box (${boundingBox.volume()} vx) is too large. Tiff export is only supported for up to 1Gvx at a time.`} /> : null;
  const edgeLengthExceededMessage = edgeLengthExceeded ? <Alert type="warning" message={`An edge length of the selected bounding box (${boundingBox.dimensions()}) is too large. Tiff export is only supported for boxes with no edge length over ${features().exportTiffMaxEdgeLengthVx} vx.`} /> : null;

  const downloadHint =
    startedExports.length > 0 ? (
      <p>
        Go to{" "}
        <a href="/jobs" target="_blank">
          Jobs Overview Page
        </a>{" "}
        to see running exports and to download the results.
      </p>
    ) : null;

  const bboxText = Utils.computeArrayFromBoundingBox(boundingBox).join(", ");

  return (
    <Modal
      title="Export Bounding Box as Tiff Stack"
      onCancel={handleClose}
      visible
      width={500}
      footer={null}
    >
      <p>
        Data from the selected bounding box at {bboxText} will be exported as a tiff stack zip
        archive.
      </p>
      <p>Please select a layer to export:</p>

      {volumeExceededMessage}
      {edgeLengthExceededMessage}

      { volumeExceeded || edgeLengthExceeded ? null : exportButtonsList }

      {downloadHint}
    </Modal>
  );
};

export default ExportBoundingBoxModal;
