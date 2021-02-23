// @flow
import { Button, Modal } from "antd";
import React, { useState } from "react";
import type { BoundingBoxType } from "oxalis/constants";
import type { APIDataset } from "types/api_flow_types";
import { startTiffExportJob } from "admin/admin_rest_api";
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
    console.log("start export for", layerName);
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
          disabled={startedExports.includes(layerName)}
        >
          {layerName}
          {startedExports.includes(layerName) ? " (started)" : null}
        </Button>
      </p>
    ) : null,
  );

  const downloadHint =
    startedExports.length > 0 ? (
      <p>
        Go to{" "}
        <a href="/jobs" target="_blank">
          Jobs Overview Page
        </a>{" "}
        for running exports and to download the results.
      </p>
    ) : null;

  console.log(dataset.dataSource.dataLayers);

  const bboxText = Utils.computeArrayFromBoundingBox(boundingBox).join(", ");

  return (
    <Modal
      title="Export Bounding Box as Tiff Stack"
      onCancel={handleClose}
      visible
      width={500}
      footer={[
        <Button key="close" type="primary" onClick={handleClose}>
          close
        </Button>,
      ]}
    >
      <p>
        Data from the selected bounding box at {bboxText} will be exported as tiff stack zip
        archive.
      </p>
      <p>Please select a layer to export:</p>

      {exportButtonsList}

      {downloadHint}
    </Modal>
  );
};

export default ExportBoundingBoxModal;
