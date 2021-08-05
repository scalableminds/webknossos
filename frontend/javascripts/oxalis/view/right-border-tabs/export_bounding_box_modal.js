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
import { useSelector } from "react-redux";

type Props = {
  handleClose: () => void,
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
  mappingName: ?string,
  mappingType: ?string,
  hideUnmappedIds: ?boolean,
  isColorLayer: ?boolean,
};

const ExportBoundingBoxModal = ({ handleClose, dataset, boundingBox, tracing }: Props) => {
  const [startedExports, setStartedExports] = useState([]);
  const volumeTracing = tracing != null ? tracing.volume : null;
  const annotationId = tracing != null ? tracing.annotationId : null;
  const annotationType = tracing != null ? tracing.annotationType : null;
  const isMappingEnabled = useSelector(
    state => state.temporaryConfiguration.activeMapping.isMappingEnabled,
  );
  const hideUnmappedIds = useSelector(
    state => state.temporaryConfiguration.activeMapping.hideUnmappedIds,
  );
  const mappingName = useSelector(state => state.temporaryConfiguration.activeMapping.mappingName);
  const mappingType = useSelector(state => state.temporaryConfiguration.activeMapping.mappingType);
  const isMergerModeEnabled = useSelector(
    state => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const existsActivePersistentMapping = isMappingEnabled && !isMergerModeEnabled;

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
      layerInfos.mappingName,
      layerInfos.mappingType,
      layerInfos.hideUnmappedIds,
    );
  };

  const hasMag1 = (layer: APIDataLayer) => getResolutionInfo(layer.resolutions).hasIndex(0);

  const allLayerInfos = dataset.dataSource.dataLayers.map(layer => {
    const isColorLayer = layer.category === "color";
    if (layer.category === "color" || volumeTracing == null)
      return {
        displayName: layer.name,
        layerName: layer.name,
        tracingId: null,
        annotationId: null,
        annotationType: null,
        tracingVersion: null,
        hasMag1: hasMag1(layer),
        hideUnmappedIds: !isColorLayer && existsActivePersistentMapping ? hideUnmappedIds : null,
        mappingName: !isColorLayer && existsActivePersistentMapping ? mappingName : null,
        mappingType: !isColorLayer && existsActivePersistentMapping ? mappingType : null,
        isColorLayer,
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
        hideUnmappedIds: existsActivePersistentMapping ? hideUnmappedIds : null,
        mappingName: existsActivePersistentMapping ? mappingName : null,
        mappingType: existsActivePersistentMapping ? mappingType : null,
        isColorLayer: false,
      };
    return {
      displayName: "Volume annotation",
      layerName: null,
      tracingId: volumeTracing.tracingId,
      annotationId,
      annotationType,
      tracingVersion: volumeTracing.version,
      hasMag1: hasMag1(layer),
      hideUnmappedIds: null,
      mappingName: null,
      mappingType: null,
      isColorLayer: false,
    };
  });

  const exportButtonsList = allLayerInfos.map(layerInfos =>
    layerInfos ? (
      <p>
        <Button
          key={exportKey(layerInfos)}
          onClick={() => handleStartExport(layerInfos)}
          disabled={
            startedExports.includes(exportKey(layerInfos)) ||
            !layerInfos.hasMag1 ||
            (isMergerModeEnabled && !layerInfos.isColorLayer)
          }
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
  let activeMappingMessage = null;
  if (isMergerModeEnabled) {
    activeMappingMessage =
      "Exporting a volume layer does not export merger mode currently. Please disable merger mode before exporting data.";
  } else if (isMappingEnabled) {
    activeMappingMessage = `The active mapping ${mappingName} will be applied to the exported data.`;
  }

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
        archive. {activeMappingMessage}
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
