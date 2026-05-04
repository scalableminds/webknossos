import { useStartAndPollJob } from "admin/job/job_hooks";
import { doWithToken, downloadWithFilename, startExportTiffJob } from "admin/rest_api";
import { Alert, Button, Checkbox, Col, Divider, Flex, Row, Segmented, Typography } from "antd";
import type { SegmentedOptions } from "antd/es/segmented";
import { LayerSelection } from "components/layer_selection";
import features from "features";
import { formatCountToDataAmountUnit, formatScale } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import {
  computeArrayFromBoundingBox,
  computeBoundingBoxFromBoundingBoxObject,
  computeShapeFromBoundingBox,
} from "libs/utils";
import messages from "messages";
import { useState } from "react";
import {
  type AdditionalAxis,
  type APIDataLayer,
  type APIDataset,
  APIJobCommand,
  type VoxelSize,
} from "types/api_types";
import type { BoundingBoxMinMaxType } from "types/bounding_box";
import type { Vector3 } from "viewer/constants";
import {
  getByteCountFromLayer,
  getDataLayers,
  getLayerByName,
  getMagInfo,
} from "viewer/model/accessors/dataset_accessor";
import { getAdditionalCoordinatesAsString } from "viewer/model/accessors/flycam_accessor";
import { getUserBoundingBoxesFromState } from "viewer/model/accessors/tracing_accessor";
import {
  getReadableNameOfVolumeLayer,
  getVolumeTracingById,
} from "viewer/model/accessors/volumetracing_accessor";
import { Model } from "viewer/singletons";
import type { StoreAnnotation, UserBoundingBox } from "viewer/store";
import { BoundingBoxSelection } from "viewer/view/ai_jobs/components/bounding_box_selection";
import { MagSlider } from "../mag_slider";
import { WorkerInfo } from "./download_shared";

type ExportLayerInfos = {
  displayName: string;
  layerName: string | null;
  tracingId: string | null;
  annotationId: string | null;
  additionalAxes?: AdditionalAxis[] | null;
};

enum ExportFormat {
  OME_TIFF = "OME_TIFF",
  TIFF_STACK = "TIFF_STACK",
}
const ExportFormatOptions: SegmentedOptions = [
  {
    label: "OME TIFF",
    value: ExportFormat.OME_TIFF,
  },
  {
    label: "TIFF Stack (as .zip)",
    value: ExportFormat.TIFF_STACK,
  },
];

const EXPECTED_DOWNSAMPLING_FILE_SIZE_FACTOR = 1.33;

const exportKey = (layerInfos: ExportLayerInfos, mag: Vector3) =>
  `${layerInfos.layerName || ""}__${layerInfos.tracingId || ""}__${mag.join("-")}`;

function getExportLayerInfos(
  layer: APIDataLayer,
  annotation: StoreAnnotation | null | undefined,
): ExportLayerInfos {
  const annotationId = annotation != null ? annotation.annotationId : null;

  if (layer.category === "color" || !layer.tracingId) {
    return {
      displayName: layer.name,
      layerName: layer.name,
      tracingId: null,
      annotationId: null,
      additionalAxes: layer.additionalAxes,
    };
  }

  // The layer is a volume tracing layer, since tracingId exists. Therefore, a tracing
  // must exist.
  if (annotation == null) {
    // Satisfy TS.
    throw new Error("Tracing is null, but layer.tracingId is defined.");
  }
  const readableVolumeLayerName = getReadableNameOfVolumeLayer(layer, annotation) || "Volume";
  const volumeTracing = getVolumeTracingById(annotation, layer.tracingId);

  return {
    displayName: readableVolumeLayerName,
    layerName: layer.fallbackLayerInfo?.name ?? null,
    tracingId: volumeTracing.tracingId,
    annotationId,
    additionalAxes: layer.additionalAxes,
  };
}

export function isBoundingBoxExportable(boundingBox: BoundingBoxMinMaxType, mag: Vector3) {
  const shape = computeShapeFromBoundingBox(boundingBox);
  const volume =
    Math.ceil(shape[0] / mag[0]) * Math.ceil(shape[1] / mag[1]) * Math.ceil(shape[2] / mag[2]);
  const volumeExceeded = volume > features().exportTiffMaxVolumeMVx * 1024 * 1024;
  const edgeLengthExceeded = shape.some(
    (length, index) => length / mag[index] > features().exportTiffMaxEdgeLengthVx,
  );

  const alerts = (
    <Flex vertical gap="small">
      {volumeExceeded && (
        <Alert
          type="error"
          title={`The volume of the selected bounding box (${volume} vx) is too large. Tiff export is only supported for up to ${
            features().exportTiffMaxVolumeMVx
          } Megavoxels.`}
        />
      )}
      {edgeLengthExceeded && (
        <Alert
          type="error"
          title={`An edge length of the selected bounding box (${shape.join(
            ", ",
          )}) is too large. Tiff export is only supported for boxes with edges smaller than ${
            features().exportTiffMaxEdgeLengthVx
          } vx.`}
        />
      )}
    </Flex>
  );

  return {
    isExportable: !volumeExceeded && !edgeLengthExceeded,
    alerts,
  };
}

function estimateFileSize(
  selectedLayer: APIDataLayer,
  mag: Vector3,
  boundingBox: BoundingBoxMinMaxType,
  exportFormat: ExportFormat,
) {
  const shape = computeShapeFromBoundingBox(boundingBox);
  const volume =
    Math.ceil(shape[0] / mag[0]) * Math.ceil(shape[1] / mag[1]) * Math.ceil(shape[2] / mag[2]);
  return formatCountToDataAmountUnit(
    volume *
      getByteCountFromLayer(selectedLayer) *
      (exportFormat === ExportFormat.OME_TIFF ? EXPECTED_DOWNSAMPLING_FILE_SIZE_FACTOR : 1),
  );
}

function formatSelectedScale(dataset: APIDataset, mag: Vector3) {
  const magAdaptedScale = dataset.dataSource.scale.factor.map((f, i) => f * mag[i]);
  const unit = dataset.dataSource.scale.unit;
  const scale = { factor: magAdaptedScale, unit } as VoxelSize;
  return formatScale(scale);
}

export function DownloadTiffTab({
  isAnnotation,
  initialBoundingBoxId,
  onClose,
}: {
  isAnnotation: boolean;
  initialBoundingBoxId?: number;
  onClose: () => void;
}) {
  const annotation = useWkSelector((state) => state.annotation);
  const dataset = useWkSelector((state) => state.dataset);
  const rawUserBoundingBoxes = useWkSelector((state) => getUserBoundingBoxesFromState(state));
  const isMergerModeEnabled = useWkSelector(
    (state) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const currentAdditionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);

  const [keepWindowOpen, setKeepWindowOpen] = useState(true);
  const [selectedLayerName, setSelectedLayerName] = useState<string>(
    dataset.dataSource.dataLayers[0].name,
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat>(ExportFormat.OME_TIFF);

  const { runningJobs: runningExportJobs, startJob } = useStartAndPollJob({
    async onSuccess(job) {
      if (job.resultLink != null) {
        const token = await doWithToken(async (t) => t);
        downloadWithFilename(`${job.resultLink}?token=${token}`);
      }
    },
    onFailure() {
      Toast.error("Error when exporting data. Please contact us for support.");
    },
  });

  const typeName = isAnnotation ? "annotation" : "dataset";
  const layers = getDataLayers(dataset);
  const selectedLayer = getLayerByName(dataset, selectedLayerName);
  const selectedLayerInfos = getExportLayerInfos(selectedLayer, annotation);
  const selectedLayerMagInfo = getMagInfo(selectedLayer.mags);

  const userBoundingBoxes = [
    ...rawUserBoundingBoxes,
    {
      id: -1,
      name: "Full layer",
      boundingBox: computeBoundingBoxFromBoundingBoxObject(selectedLayer.boundingBox),
      color: [255, 255, 255],
      isVisible: true,
    } as UserBoundingBox,
  ];

  const [selectedBoundingBoxId, setSelectedBoundingBoxId] = useState(
    initialBoundingBoxId ?? userBoundingBoxes[0].id,
  );
  const [rawMag, setMag] = useState<Vector3>(selectedLayerMagInfo.getFinestMag());

  const mag = selectedLayerMagInfo.getClosestExistingMag(rawMag);
  const selectedBoundingBox = userBoundingBoxes.find(
    (bbox) => bbox.id === selectedBoundingBoxId,
  ) as UserBoundingBox;
  const { isExportable, alerts: boundingBoxCompatibilityAlerts } = isBoundingBoxExportable(
    selectedBoundingBox.boundingBox,
    mag,
  );
  const onlyOneMagAvailable = selectedLayerMagInfo.getMagList().length === 1;
  const isCurrentlyRunningExportJob = runningExportJobs.some(
    ([key]) => key === exportKey(selectedLayerInfos, mag),
  );
  const isDownloadButtonDisabled =
    !isExportable || isCurrentlyRunningExportJob || isMergerModeEnabled;

  const handleKeepWindowOpenChecked = (e: any) => {
    setKeepWindowOpen(e.target.checked);
  };

  const handleExport = async () => {
    if (startJob == null) {
      console.error("Could not start Tiff export.");
      return;
    }

    await Model.ensureSavedState();
    await startJob(async () => {
      const job = await startExportTiffJob(
        dataset.id,
        computeArrayFromBoundingBox(selectedBoundingBox.boundingBox),
        currentAdditionalCoordinates,
        selectedLayerInfos.layerName,
        mag.join("-"),
        selectedLayerInfos.annotationId,
        selectedLayerInfos.displayName,
        exportFormat === ExportFormat.OME_TIFF,
      );
      return [exportKey(selectedLayerInfos, mag), job.id];
    });

    if (!keepWindowOpen) {
      onClose();
    }
  };

  return (
    <Flex vertical>
      <Typography.Paragraph>
        {messages["download.export_as_tiff"]({ typeName })} Visit the{" "}
        <a href="/jobs" target="_blank" rel="noreferrer">
          Jobs Overview Page
        </a>{" "}
        to track progress and download results.
      </Typography.Paragraph>
      {!dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobCommand.EXPORT_TIFF) ? (
        <WorkerInfo />
      ) : (
        <div>
          <Divider>Export format</Divider>
          <Flex justify="center">
            <Segmented
              value={exportFormat}
              onChange={(value) => setExportFormat(value as ExportFormat)}
              options={ExportFormatOptions}
              size="large"
            />
          </Flex>

          <Divider>Layer</Divider>
          <LayerSelection
            layers={layers}
            value={selectedLayerName}
            onChange={setSelectedLayerName}
            getReadableNameForLayer={(layer) =>
              getReadableNameOfVolumeLayer(layer, annotation) || layer.name
            }
            style={{ width: "100%" }}
          />

          <Divider>Bounding Box</Divider>
          <Flex vertical gap="small">
            <BoundingBoxSelection
              value={selectedBoundingBoxId}
              userBoundingBoxes={userBoundingBoxes}
              setSelectedBoundingBoxId={(boxId: number | null) => {
                if (boxId != null) {
                  setSelectedBoundingBoxId(boxId);
                }
              }}
              style={{ width: "100%" }}
            />
            {boundingBoxCompatibilityAlerts}
          </Flex>

          {(selectedLayerInfos.additionalAxes?.length || 0) > 0 && (
            <>
              <Divider>Additional Coordinates</Divider>
              <Typography.Paragraph>
                Your dataset has more than three dimensions. The export will only include the
                selected bounding box at the current additional dimensions:{" "}
                {getAdditionalCoordinatesAsString(currentAdditionalCoordinates)}
              </Typography.Paragraph>
            </>
          )}

          <Divider>Mag</Divider>
          {!onlyOneMagAvailable && (
            <Row>
              <Col span={19}>
                <MagSlider magnificationInfo={selectedLayerMagInfo} value={mag} onChange={setMag} />
              </Col>
              <Col span={5}>
                <Flex justify="flex-end" align="center">
                  {mag.join("-")}
                </Flex>
              </Col>
            </Row>
          )}
          <Typography.Paragraph>
            {onlyOneMagAvailable && <div>{mag.join("-")}</div>}
            Estimated file size:{" "}
            {estimateFileSize(selectedLayer, mag, selectedBoundingBox.boundingBox, exportFormat)}
            <br />
            Magnification: {formatSelectedScale(dataset, mag)}
          </Typography.Paragraph>
        </div>
      )}
      <Divider />
      <Flex justify="space-between" align="center">
        <Checkbox
          checked={keepWindowOpen}
          onChange={handleKeepWindowOpenChecked}
          disabled={!features().jobsEnabled}
        >
          Keep window open
        </Checkbox>
        <Flex gap="small">
          <Button
            href="https://docs.webknossos.org/webknossos/data/export_ui.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn More
          </Button>
          <Button
            type="primary"
            onClick={handleExport}
            disabled={isDownloadButtonDisabled}
            loading={isCurrentlyRunningExportJob}
          >
            Export
          </Button>
        </Flex>
      </Flex>
    </Flex>
  );
}
