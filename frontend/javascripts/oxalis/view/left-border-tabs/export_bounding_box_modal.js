// @flow
import { Button, Modal, Alert } from "antd";
import React, { useState } from "react";
import type { BoundingBoxType } from "oxalis/constants";
import type { Tracing, AnnotationType } from "oxalis/store";
import type { APIDataset, APIDataLayer } from "types/api_flow_types";
import { startExportTiffJob } from "admin/admin_rest_api";
import { getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import Model from "oxalis/model";
import features from "features";
import * as Utils from "libs/utils";

type Props = {
  destroy: () => void,
  tracing: ?Tracing,
  dataset: APIDataset,
  boundingBox: BoundingBoxType,
};

type LayerInfos = {
  displayName: string,
  layerName: ?string,
  tracingId: ?string,
  annotationId: ?string,
  annotationType: ?AnnotationType,
  tracingVersion: ?number,
  hasMag1: boolean,
};

const ExportBoundingBoxModal = ({ destroy, dataset, boundingBox, tracing }: Props) => {
  const [startedExports, setStartedExports] = useState([]);
  const volumeTracing = tracing != null ? tracing.volume : null;
  const annotationId = tracing != null ? tracing.annotationId : null;
  const annotationType = tracing != null ? tracing.annotationType : null;

  const handleClose = () => {
    destroy();
  };

  const exportKey = (layerInfos: LayerInfos) =>
    (layerInfos.layerName || "") + (layerInfos.tracingId || "");

  const handleStartExport = async (layerInfos: LayerInfos) => {
    setStartedExports(startedExports.concat(exportKey(layerInfos)));
    if (layerInfos.tracingId) {
      await Model.ensureSavedState();
    }
    await startExportTiffJob(
      dataset.name,
      dataset.owningOrganization,
      Utils.computeArrayFromBoundingBox(boundingBox),
      layerInfos.layerName,
      layerInfos.tracingId,
      layerInfos.annotationId,
      layerInfos.annotationType,
    );
  };

  const hasMag1 = (layer: APIDataLayer) => getResolutionInfo(layer.resolutions).hasIndex(0);

  const allLayerInfos = dataset.dataSource.dataLayers.map(layer => {
    if (layer.category === "color" || volumeTracing == null)
      return {
        displayName: layer.name,
        layerName: layer.name,
        tracingId: null,
        annotationId: null,
        annotationType: null,
        tracingVersion: null,
        hasMag1: hasMag1(layer),
      };
    if (layer.fallbackLayerInfo != null)
      return {
        displayName: "Volume annotation with fallback segmentation",
        layerName: layer.fallbackLayerInfo.name,
        tracingId: volumeTracing.tracingId,
        annotationId,
        annotationType,
        tracingVersion: volumeTracing.version,
        hasMag1: hasMag1(layer),
      };
    return {
      displayName: "Volume annotation",
      layerName: null,
      tracingId: volumeTracing.tracingId,
      annotationId,
      annotationType,
      tracingVersion: volumeTracing.version,
      hasMag1: hasMag1(layer),
    };
  });

  const exportButtonsList = allLayerInfos.map(layerInfos =>
    layerInfos ? (
      <p>
        <Button
          key={exportKey(layerInfos)}
          onClick={() => handleStartExport(layerInfos)}
          disabled={startedExports.includes(exportKey(layerInfos)) || !layerInfos.hasMag1}
        >
          {layerInfos.displayName}
          {!layerInfos.hasMag1 ? " (resolution 1 missing)" : ""}
          {startedExports.includes(exportKey(layerInfos)) ? " (started)" : ""}
        </Button>
      </p>
    ) : null,
  );

  const dimensions = boundingBox.max.map((maxItem, index) => maxItem - boundingBox.min[index]);
  const volume = dimensions[0] * dimensions[1] * dimensions[2];
  const volumeExceeded = volume > features().exportTiffMaxVolumeMVx * 1024 * 1024;
  const edgeLengthExceeded = dimensions.some(
    length => length > features().exportTiffMaxEdgeLengthVx,
  );
  const volumeExceededMessage = volumeExceeded ? (
    <Alert
      type="error"
      message={`The volume of the selected bounding box (${volume} vx) is too large. Tiff export is only supported for up to ${
        features().exportTiffMaxVolumeMVx
      } Megavoxels.`}
    />
  ) : null;
  const edgeLengthExceededMessage = edgeLengthExceeded ? (
    <Alert
      type="error"
      message={`An edge length of the selected bounding box (${dimensions.join(
        ", ",
      )}) is too large. Tiff export is only supported for boxes with no edge length over ${
        features().exportTiffMaxEdgeLengthVx
      } vx.`}
    />
  ) : null;

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

      {volumeExceededMessage}
      {edgeLengthExceededMessage}

      {volumeExceeded || edgeLengthExceeded ? null : (
        <div>
          {" "}
          <p>Please select a layer to export:</p> {exportButtonsList}
        </div>
      )}

      {downloadHint}
    </Modal>
  );
};

export default ExportBoundingBoxModal;
