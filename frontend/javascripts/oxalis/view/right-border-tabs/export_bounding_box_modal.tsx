import { Button, Modal, Alert, Form, Radio, Slider, Divider, Row, Col } from "antd";
import { useSelector } from "react-redux";
import React, { useState } from "react";
import type { APIDataset, APIDataLayer, APIJob } from "types/api_flow_types";
import type { BoundingBoxType, Vector3 } from "oxalis/constants";
import type { OxalisState, Tracing, HybridTracing } from "oxalis/store";
import {
  getResolutionInfo,
  getDatasetResolutionInfo,
  getByteCountFromLayer,
} from "oxalis/model/accessors/dataset_accessor";
import { getVolumeTracingById } from "oxalis/model/accessors/volumetracing_accessor";
import { doWithToken, getJob, getJobs, startExportTiffJob } from "admin/admin_rest_api";
import { Model } from "oxalis/singletons";
import * as Utils from "libs/utils";
import features from "features";
import _ from "lodash";
import { getReadableNameOfVolumeLayer, LayerSelection } from "./starting_job_modals";
import { formatBytes } from "libs/format_utils";
import { usePolling } from "libs/react_hooks";
import Toast from "libs/toast";
import { SyncOutlined } from "@ant-design/icons";

type Props = {
  handleClose: () => void;
  tracing: Tracing;
  dataset: APIDataset;
  boundingBox: BoundingBoxType;
};
type LayerInfos = {
  displayName: string;
  layerName: string | null;
  byteCount: number;
  tracingId: string | null;
  annotationId: string | null;
  isColorLayer: boolean;
  lowestResolutionIndex: number;
  highestResolutionIndex: number;
};

export enum ExportFormat {
  OME_TIFF = "OME_TIFF",
  TIFF_STACK = "TIFF_STACK",
}

const EXPECTED_DOWNSAMPLING_FILE_SIZE_FACTOR = 1.33;

export const exportKey = (layerInfos: LayerInfos, resolutionIndex: number) =>
  `${layerInfos.layerName || ""}__${layerInfos.tracingId || ""}__${resolutionIndex}`;

export function getLayerInfos(
  layer: APIDataLayer,
  tracing: HybridTracing | null | undefined,
): LayerInfos {
  const annotationId = tracing != null ? tracing.annotationId : null;
  const isColorLayer = layer.category === "color";

  const highestResolutionIndex = getResolutionInfo(layer.resolutions).getHighestResolutionIndex();
  const lowestResolutionIndex = getResolutionInfo(layer.resolutions).getClosestExistingIndex(0);

  if (layer.category === "color" || !layer.tracingId) {
    return {
      displayName: layer.name,
      layerName: layer.name,
      byteCount: getByteCountFromLayer(layer),
      tracingId: null,
      annotationId: null,
      isColorLayer,
      lowestResolutionIndex,
      highestResolutionIndex,
    };
  }

  // The layer is a volume tracing layer, since tracingId exists. Therefore, a tracing
  // must exist.
  if (tracing == null) {
    // Satisfy TS.
    throw new Error("Tracing is null, but layer.tracingId is defined.");
  }
  const readableVolumeLayerName = getReadableNameOfVolumeLayer(layer, tracing) || "Volume";
  const volumeTracing = getVolumeTracingById(tracing, layer.tracingId);

  if (layer.fallbackLayerInfo != null) {
    return {
      displayName: readableVolumeLayerName,
      layerName: layer.fallbackLayerInfo.name,
      lowestResolutionIndex,
      highestResolutionIndex,
      byteCount: getByteCountFromLayer(layer),
      tracingId: volumeTracing.tracingId,
      annotationId,
      isColorLayer: false,
    };
  }

  return {
    displayName: readableVolumeLayerName,
    layerName: null,
    lowestResolutionIndex,
    highestResolutionIndex,
    byteCount: getByteCountFromLayer(layer),
    tracingId: volumeTracing.tracingId,
    annotationId,
    isColorLayer: false,
  };
}

export function isBoundingBoxExportable(boundingBox: BoundingBoxType, mag: Vector3) {
  const shape = Utils.computeShapeFromBoundingBox(boundingBox);
  const volume =
    Math.ceil(shape[0] / mag[0]) * Math.ceil(shape[1] / mag[1]) * Math.ceil(shape[2] / mag[2]);
  const volumeExceeded = volume > features().exportTiffMaxVolumeMVx * 1024 * 1024;
  const edgeLengthExceeded = shape.some(
    (length, index) => length / mag[index] > features().exportTiffMaxEdgeLengthVx,
  );

  const alertMessage = _.compact([
    volumeExceeded
      ? `The volume of the selected bounding box (${volume} vx) is too large. Tiff export is only supported for up to ${
          features().exportTiffMaxVolumeMVx
        } Megavoxels.`
      : null,
    edgeLengthExceeded
      ? `An edge length of the selected bounding box (${shape.join(
          ", ",
        )}) is too large. Tiff export is only supported for boxes with no edge length over ${
          features().exportTiffMaxEdgeLengthVx
        } vx.`
      : null,
  ]).join("\n");
  const alerts = alertMessage.length > 0 ? <Alert type="error" message={alertMessage} /> : null;

  return {
    isExportable: !volumeExceeded && !edgeLengthExceeded,
    alerts,
  };
}

export function useRunningJobs(): [
  Array<[string, string]>,
  (
    dataset: APIDataset,
    boundingBox: BoundingBoxType,
    resolutionIndex: number,
    selectedLayerInfos: LayerInfos,
    exportFormat: ExportFormat,
  ) => Promise<void>,
] {
  const [runningJobs, setRunningJobs] = useState<Array<[string, string]>>([]);

  async function checkForJobs() {
    for (const [, jobId] of runningJobs) {
      const job = await getJob(jobId);
      if (job.state === "SUCCESS" && job.resultLink != null) {
        const token = await doWithToken(async (t) => t);
        window.open(`${job.resultLink}?token=${token}`, "_blank");
        setRunningJobs((previous) => previous.filter(([, j]) => j !== jobId));
      } else if (job.state === "FAILURE") {
        Toast.error("Error when exporting data. Please contact us for support.");
        setRunningJobs((previous) => previous.filter(([, j]) => j !== jobId));
      } else if (job.state === "MANUAL") {
        Toast.error(
          "The data could not be exported automatically. The job will be handled by an admin shortly.",
        );
        setRunningJobs((previous) => previous.filter(([, j]) => j !== jobId));
      }
    }
  }

  usePolling(
    checkForJobs,
    runningJobs.length > 0 ? 1000 : null,
    runningJobs.map(([key]) => key),
  );

  return [
    runningJobs,
    async (dataset, boundingBox, resolutionIndex, selectedLayerInfos, exportFormat) => {
      const datasetResolutionInfo = getDatasetResolutionInfo(dataset);
      const job = await startExportTiffJob(
        dataset.name,
        dataset.owningOrganization,
        Utils.computeArrayFromBoundingBox(boundingBox),
        selectedLayerInfos.layerName,
        datasetResolutionInfo.getResolutionByIndexOrThrow(resolutionIndex).join("-"),
        selectedLayerInfos.annotationId,
        selectedLayerInfos.displayName,
        exportFormat === ExportFormat.OME_TIFF,
      );
      setRunningJobs((previous) => [
        ...previous,
        [exportKey(selectedLayerInfos, resolutionIndex), job.id],
      ]);
    },
  ];
}

export function estimateFileSize(
  selectedLayer: APIDataLayer,
  resolutionIndex: number,
  boundingBox: BoundingBoxType,
  exportFormat: ExportFormat,
) {
  const mag = getResolutionInfo(selectedLayer.resolutions).getResolutionByIndexOrThrow(
    resolutionIndex,
  );
  const shape = Utils.computeShapeFromBoundingBox(boundingBox);
  const volume =
    Math.ceil(shape[0] / mag[0]) * Math.ceil(shape[1] / mag[1]) * Math.ceil(shape[2] / mag[2]);
  return formatBytes(
    volume *
      getByteCountFromLayer(selectedLayer) *
      (exportFormat === ExportFormat.OME_TIFF ? EXPECTED_DOWNSAMPLING_FILE_SIZE_FACTOR : 1),
  );
}

function ExportBoundingBoxModal({ handleClose, dataset, boundingBox, tracing }: Props) {
  const [runningJobs, triggerJob] = useRunningJobs();
  const isMergerModeEnabled = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat>(ExportFormat.OME_TIFF);
  const [selectedLayerName, setSelectedLayerName] = useState<string>(
    dataset.dataSource.dataLayers[0].name,
  );

  const selectedLayer = dataset.dataSource.dataLayers.find(
    (l) => l.name === selectedLayerName,
  ) as APIDataLayer;
  const selectedLayerInfos = getLayerInfos(selectedLayer, tracing);

  const datasetResolutionInfo = getDatasetResolutionInfo(dataset);
  const { lowestResolutionIndex, highestResolutionIndex } = selectedLayerInfos;
  const [rawResolutionIndex, setResolutionIndex] = useState<number>(lowestResolutionIndex);
  const resolutionIndex = Utils.clamp(
    lowestResolutionIndex,
    rawResolutionIndex,
    highestResolutionIndex,
  );

  const { isExportable, alerts } = isBoundingBoxExportable(
    boundingBox,
    datasetResolutionInfo.getResolutionByIndexOrThrow(resolutionIndex),
  );

  const downloadHint =
    runningJobs.length > 0 ? (
      <p>
        Go to{" "}
        <a href="/jobs" target="_blank" rel="noreferrer">
          Jobs Overview Page
        </a>{" "}
        to see running exports and to download the results.
      </p>
    ) : null;

  return (
    <Modal
      title="Export Bounding Box"
      onCancel={handleClose}
      visible
      width={500}
      footer={
        <Button
          key="ok"
          type="primary"
          disabled={
            !isExportable ||
            runningJobs.some(([key]) => key === exportKey(selectedLayerInfos, resolutionIndex)) || // The export is already running or...
            isMergerModeEnabled // Merger mode is enabled
          }
          onClick={async () => {
            if (selectedLayerInfos.tracingId != null) {
              await Model.ensureSavedState();
            }
            await triggerJob(
              dataset,
              boundingBox,
              resolutionIndex,
              selectedLayerInfos,
              exportFormat,
            );
          }}
        >
          {runningJobs.some(([key]) => key === exportKey(selectedLayerInfos, resolutionIndex)) && (
            <>
              <SyncOutlined spin />{" "}
            </>
          )}
          Export
        </Button>
      }
    >
      <p>
        Data from the selected bounding box at{" "}
        <code>{Utils.computeArrayFromBoundingBox(boundingBox).join(", ")}</code> will be exported.
      </p>

      {alerts}

      <Divider
        style={{
          margin: "18px 0",
        }}
      >
        Export format
      </Divider>
      <Radio.Group value={exportFormat} onChange={(ev) => setExportFormat(ev.target.value)}>
        <Radio.Button value={ExportFormat.OME_TIFF}>OME-TIFF</Radio.Button>
        <Radio.Button value={ExportFormat.TIFF_STACK}>TIFF stack (as .zip)</Radio.Button>
      </Radio.Group>

      <Divider
        style={{
          margin: "18px 0",
        }}
      >
        Layer
      </Divider>
      <LayerSelection
        layers={dataset.dataSource.dataLayers}
        onChange={setSelectedLayerName}
        tracing={tracing}
        value={selectedLayerName}
        style={{ width: "100%" }}
      />

      <Divider
        style={{
          margin: "18px 0",
        }}
      >
        Mag
      </Divider>
      <Row>
        <Col span={20}>
          <Slider
            tooltip={{
              formatter: (value) =>
                datasetResolutionInfo.getResolutionByIndexOrThrow(resolutionIndex).join("-"),
            }}
            min={lowestResolutionIndex}
            max={highestResolutionIndex}
            step={1}
            value={resolutionIndex}
            onChange={(value) => setResolutionIndex(value)}
          />
        </Col>
        <Col span={4} style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
          {datasetResolutionInfo.getResolutionByIndexOrThrow(resolutionIndex).join("-")}
        </Col>
      </Row>
      <p>
        Estimated file size:{" "}
        {estimateFileSize(selectedLayer, resolutionIndex, boundingBox, exportFormat)}
      </p>

      {downloadHint}
    </Modal>
  );
}

export default ExportBoundingBoxModal;
