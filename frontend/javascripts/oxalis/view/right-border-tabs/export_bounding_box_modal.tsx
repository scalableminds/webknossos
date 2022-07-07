import { Button, Modal, Alert } from "antd";
import { useSelector } from "react-redux";
import React, { useState } from "react";
import type { APIDataset, APIDataLayer, APIAnnotationType } from "types/api_flow_types";
import type { BoundingBoxType } from "oxalis/constants";
import { MappingStatusEnum } from "oxalis/constants";
import type { OxalisState, Tracing, HybridTracing } from "oxalis/store";
import { getResolutionInfo, getMappingInfo } from "oxalis/model/accessors/dataset_accessor";
import { getVolumeTracingById } from "oxalis/model/accessors/volumetracing_accessor";
import { startExportTiffJob } from "admin/admin_rest_api";
import Model from "oxalis/model";
import * as Utils from "libs/utils";
import features from "features";
import _ from "lodash";
import { getReadableNameOfVolumeLayer } from "./starting_job_modals";
type Props = {
  handleClose: () => void;
  tracing: Tracing | null | undefined;
  dataset: APIDataset;
  boundingBox: BoundingBoxType;
};
type LayerInfos = {
  displayName: string;
  layerName: string | null | undefined;
  tracingId: string | null | undefined;
  annotationId: string | null | undefined;
  annotationType: APIAnnotationType | null | undefined;
  hasMag1: boolean;
  mappingName: string | null | undefined;
  mappingType: string | null | undefined;
  hideUnmappedIds: boolean | null | undefined;
  isColorLayer: boolean | null | undefined;
};

const exportKey = (layerInfos: LayerInfos) =>
  (layerInfos.layerName || "") + (layerInfos.tracingId || "");

export function getLayerInfos(
  layer: APIDataLayer,
  tracing: HybridTracing | null | undefined,
  activeMappingInfos: any,
  isMergerModeEnabled: boolean,
): LayerInfos {
  const annotationId = tracing != null ? tracing.annotationId : null;
  const annotationType = tracing != null ? tracing.annotationType : null;

  const hasMag1 = (dataLayer: APIDataLayer) => getResolutionInfo(dataLayer.resolutions).hasIndex(0);
  const { mappingStatus, hideUnmappedIds, mappingName, mappingType } = getMappingInfo(
    activeMappingInfos,
    layer.name,
  );
  const existsActivePersistentMapping =
    mappingStatus === MappingStatusEnum.ENABLED && !isMergerModeEnabled;
  const isColorLayer = layer.category === "color";

  if (layer.category === "color" || !layer.tracingId) {
    return {
      displayName: layer.name,
      layerName: layer.name,
      tracingId: null,
      annotationId: null,
      annotationType: null,
      hasMag1: hasMag1(layer),
      hideUnmappedIds: !isColorLayer && existsActivePersistentMapping ? hideUnmappedIds : null,
      mappingName: !isColorLayer && existsActivePersistentMapping ? mappingName : null,
      mappingType: !isColorLayer && existsActivePersistentMapping ? mappingType : null,
      isColorLayer,
    };
  }

  // The layer is a volume tracing layer, since tracingId exists. Therefore, a tracing
  // must exist.
  if (tracing == null) {
    // Satisfy flow.
    throw new Error("Tracing is null, but layer.tracingId is defined.");
  }
  const readbleVolumeLayerName = getReadableNameOfVolumeLayer(layer, tracing) || "Volume";
  const volumeTracing = getVolumeTracingById(tracing, layer.tracingId);

  if (layer.fallbackLayerInfo != null) {
    return {
      displayName: readbleVolumeLayerName,
      layerName: layer.fallbackLayerInfo.name,
      tracingId: volumeTracing.tracingId,
      annotationId,
      annotationType,
      hasMag1: hasMag1(layer),
      hideUnmappedIds: existsActivePersistentMapping ? hideUnmappedIds : null,
      mappingName: existsActivePersistentMapping ? mappingName : null,
      mappingType: existsActivePersistentMapping ? mappingType : null,
      isColorLayer: false,
    };
  }

  return {
    displayName: readbleVolumeLayerName,
    layerName: null,
    tracingId: volumeTracing.tracingId,
    annotationId,
    annotationType,
    hasMag1: hasMag1(layer),
    hideUnmappedIds: null,
    mappingName: null,
    mappingType: null,
    isColorLayer: false,
  };
}

export async function handleStartExport(
  dataset: APIDataset,
  layerInfos: LayerInfos,
  boundingBox: BoundingBoxType,
  startedExports: string[],
  setStartedExports?: React.Dispatch<React.SetStateAction<string[]>>,
) {
  if (setStartedExports) {
    setStartedExports(startedExports.concat(exportKey(layerInfos)));
  }

  if (layerInfos.tracingId) {
    await Model.ensureSavedState();
  }

  await startExportTiffJob(
    dataset.name,
    dataset.owningOrganization,
    Utils.computeArrayFromBoundingBox(boundingBox),
    layerInfos.layerName,
    layerInfos.annotationId,
    layerInfos.annotationType,
    layerInfos.displayName,
    layerInfos.mappingName,
    layerInfos.mappingType,
    layerInfos.hideUnmappedIds,
  );
}

export function isBoundingBoxExportable(boundingBox: BoundingBoxType) {
  const dimensions = boundingBox.max.map((maxItem, index) => maxItem - boundingBox.min[index]);
  const volume = dimensions[0] * dimensions[1] * dimensions[2];
  const volumeExceeded = volume > features().exportTiffMaxVolumeMVx * 1024 * 1024;
  const edgeLengthExceeded = dimensions.some(
    (length) => length > features().exportTiffMaxEdgeLengthVx,
  );

  const dimensionString = dimensions.join(", ");

  const volumeExceededMessage = volumeExceeded
    ? `The volume of the selected bounding box (${volume} vx) is too large. Tiff export is only supported for up to ${
        features().exportTiffMaxVolumeMVx
      } Megavoxels.`
    : null;
  const edgeLengthExceededMessage = edgeLengthExceeded
    ? `An edge length of the selected bounding box (${dimensionString}) is too large. Tiff export is only supported for boxes with no edge length over ${
        features().exportTiffMaxEdgeLengthVx
      } vx.`
    : null;

  const alertMessage = _.compact([volumeExceededMessage, edgeLengthExceededMessage]).join("\n");
  const alerts = alertMessage.length > 0 ? <Alert type="error" message={alertMessage} /> : null;

  return {
    isExportable: !volumeExceeded && !edgeLengthExceeded,
    alerts,
  };
}

function ExportBoundingBoxModal({ handleClose, dataset, boundingBox, tracing }: Props) {
  const [startedExports, setStartedExports] = useState<string[]>([]);
  const isMergerModeEnabled = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const activeMappingInfos = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.activeMappingByLayer,
  );

  const allLayerInfos = dataset.dataSource.dataLayers.map((layer: APIDataLayer) =>
    getLayerInfos(layer, tracing, activeMappingInfos, isMergerModeEnabled),
  );
  const exportButtonsList = allLayerInfos.map((layerInfos) => {
    const parenthesesInfos = [
      startedExports.includes(exportKey(layerInfos)) ? "started" : null,
      layerInfos.mappingName != null ? `using mapping "${layerInfos.mappingName}"` : null,
      !layerInfos.hasMag1 ? "resolution 1 missing" : null,
    ].filter((el) => el);
    const parenthesesInfosString =
      parenthesesInfos.length > 0 ? ` (${parenthesesInfos.join(", ")})` : "";
    return layerInfos ? (
      <p key={exportKey(layerInfos)}>
        <Button
          onClick={() =>
            handleStartExport(dataset, layerInfos, boundingBox, startedExports, setStartedExports)
          }
          disabled={
            // The export is already running or...
            startedExports.includes(exportKey(layerInfos)) || // The layer has no mag 1 or...
            !layerInfos.hasMag1 || // Merger mode is enabled and this layer is the volume tracing layer.
            (isMergerModeEnabled && layerInfos.tracingId != null)
          }
        >
          {layerInfos.displayName}
          {parenthesesInfosString}
        </Button>
      </p>
    ) : null;
  });

  const { isExportable, alerts } = isBoundingBoxExportable(boundingBox);

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
      "Exporting a volume layer does not export merger mode currently. Please disable merger mode before exporting data of the volume layer.";
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

      {alerts}

      {!isExportable ? null : (
        <div>
          {" "}
          <p>Please select a layer to export:</p> {exportButtonsList}
        </div>
      )}

      {downloadHint}
    </Modal>
  );
}

export default ExportBoundingBoxModal;
