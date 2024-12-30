import {
  Divider,
  Modal,
  Checkbox,
  Row,
  Col,
  Tabs,
  Typography,
  Button,
  Radio,
  Alert,
  Tooltip,
  type TabsProps,
} from "antd";
import { CopyOutlined } from "@ant-design/icons";
import type React from "react";
import { useState } from "react";
import { makeComponentLazy, useFetch } from "libs/react_helpers";
import {
  APIJobType,
  type VoxelSize,
  type AdditionalAxis,
  type APIDataLayer,
  type APIDataset,
} from "types/api_flow_types";
import Toast from "libs/toast";
import messages from "messages";
import { Model } from "oxalis/singletons";
import features from "features";
import {
  doWithToken,
  downloadAnnotation,
  downloadWithFilename,
  getAuthToken,
  startExportTiffJob,
} from "admin/admin_rest_api";
import { BoundingBoxSelection, MagSlider } from "oxalis/view/action-bar/starting_job_modals";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import {
  getReadableNameOfVolumeLayer,
  getVolumeTracingById,
  hasVolumeTracings,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  getByteCountFromLayer,
  getDataLayers,
  getLayerByName,
  getMagInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { useSelector } from "react-redux";
import type { HybridTracing, OxalisState, UserBoundingBox } from "oxalis/store";
import {
  computeArrayFromBoundingBox,
  computeBoundingBoxFromBoundingBoxObject,
  computeShapeFromBoundingBox,
} from "libs/utils";
import { formatCountToDataAmountUnit, formatScale } from "libs/format_utils";
import type { BoundingBoxType, Vector3 } from "oxalis/constants";
import { useStartAndPollJob } from "admin/job/job_hooks";
import { LayerSelection } from "components/layer_selection";
import { getAdditionalCoordinatesAsString } from "oxalis/model/accessors/flycam_accessor";
const { Paragraph, Text } = Typography;

type TabKeys = "download" | "export" | "python";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  isAnnotation: boolean;
  initialTab?: TabKeys;
  initialBoundingBoxId?: number;
};

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

const EXPECTED_DOWNSAMPLING_FILE_SIZE_FACTOR = 1.33;

const exportKey = (layerInfos: ExportLayerInfos, mag: Vector3) =>
  `${layerInfos.layerName || ""}__${layerInfos.tracingId || ""}__${mag.join("-")}`;

function getExportLayerInfos(
  layer: APIDataLayer,
  tracing: HybridTracing | null | undefined,
): ExportLayerInfos {
  const annotationId = tracing != null ? tracing.annotationId : null;

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
  if (tracing == null) {
    // Satisfy TS.
    throw new Error("Tracing is null, but layer.tracingId is defined.");
  }
  const readableVolumeLayerName = getReadableNameOfVolumeLayer(layer, tracing) || "Volume";
  const volumeTracing = getVolumeTracingById(tracing, layer.tracingId);

  return {
    displayName: readableVolumeLayerName,
    layerName: layer.fallbackLayerInfo?.name ?? null,
    tracingId: volumeTracing.tracingId,
    annotationId,
    additionalAxes: layer.additionalAxes,
  };
}

export function isBoundingBoxExportable(boundingBox: BoundingBoxType, mag: Vector3) {
  const shape = computeShapeFromBoundingBox(boundingBox);
  const volume =
    Math.ceil(shape[0] / mag[0]) * Math.ceil(shape[1] / mag[1]) * Math.ceil(shape[2] / mag[2]);
  const volumeExceeded = volume > features().exportTiffMaxVolumeMVx * 1024 * 1024;
  const edgeLengthExceeded = shape.some(
    (length, index) => length / mag[index] > features().exportTiffMaxEdgeLengthVx,
  );

  const alerts = (
    <>
      {volumeExceeded && (
        <Alert
          type="error"
          message={`The volume of the selected bounding box (${volume} vx) is too large. Tiff export is only supported for up to ${
            features().exportTiffMaxVolumeMVx
          } Megavoxels.`}
        />
      )}
      {edgeLengthExceeded && (
        <Alert
          type="error"
          message={`An edge length of the selected bounding box (${shape.join(
            ", ",
          )}) is too large. Tiff export is only supported for boxes with edges smaller than ${
            features().exportTiffMaxEdgeLengthVx
          } vx.`}
        />
      )}
    </>
  );

  return {
    isExportable: !volumeExceeded && !edgeLengthExceeded,
    alerts,
  };
}

function estimateFileSize(
  selectedLayer: APIDataLayer,
  mag: Vector3,
  boundingBox: BoundingBoxType,
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

export function Hint({
  children,
  style,
}: {
  children: React.ReactNode;
  style: React.CSSProperties;
}) {
  return (
    <div style={{ ...style, fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
      {children}
    </div>
  );
}

async function copyToClipboard(code: string) {
  await navigator.clipboard.writeText(code);
  Toast.success("Snippet copied to clipboard.");
}

export function CopyableCodeSnippet({ code, onCopy }: { code: string; onCopy?: () => void }) {
  return (
    <pre>
      <Button
        style={{
          float: "right",
          border: "none",
          width: "18px",
          height: "16px",
          background: "transparent",
        }}
        onClick={() => {
          copyToClipboard(code);
          if (onCopy) {
            onCopy();
          }
        }}
        icon={<CopyOutlined />}
      />
      {code}
    </pre>
  );
}

function getPythonAnnotationDownloadSnippet(authToken: string | null, tracing: HybridTracing) {
  return `import webknossos as wk

with wk.webknossos_context(
    token="${authToken || "<insert token here>"}",
    url="${window.location.origin}"
):
    annotation = wk.Annotation.download("${tracing.annotationId}")
`;
}

function getPythonDatasetDownloadSnippet(authToken: string | null, dataset: APIDataset) {
  const nonDefaultHost = !document.location.host.endsWith("webknossos.org");
  const indentation = "\n        ";
  const contextUrlAddendum = nonDefaultHost ? `, url="${window.location.origin}"` : "";
  const maybeUrlParameter = nonDefaultHost
    ? `${indentation}webknossos_url="${window.location.origin}"`
    : "";

  return `import webknossos as wk

with wk.webknossos_context(token="${authToken || "<insert token here>"}"${contextUrlAddendum}):
    # Download the dataset.
    dataset = wk.Dataset.download(
        dataset_name_or_url="${dataset.name}",
        organization_id="${dataset.owningOrganization}",${maybeUrlParameter}
    )
    # Alternatively, directly open the dataset. Image data will be
    # streamed when being accessed.
    remote_dataset = wk.Dataset.open_remote(
        dataset_name_or_url="${dataset.name}",
        organization_id="${dataset.owningOrganization}",${maybeUrlParameter}
    )
`;
}

const okTextForTab = new Map<TabKeys, string | null>([
  ["download", "Download"],
  ["export", "Export"],
  ["python", null],
]);

function _DownloadModalView({
  isOpen,
  onClose,
  isAnnotation,
  initialTab,
  initialBoundingBoxId,
}: Props): JSX.Element {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const rawUserBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );
  const currentAdditionalCoordinates = useSelector(
    (state: OxalisState) => state.flycam.additionalCoordinates,
  );
  const typeName = isAnnotation ? "annotation" : "dataset";
  const isMergerModeEnabled = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const hasVolumeFallback = tracing.volumes.some((volume) => volume.fallbackLayer != null);
  const isVolumeNDimensional = tracing.volumes.some((tracing) => tracing.additionalAxes.length > 0);
  const hasVolumes = hasVolumeTracings(tracing);
  const initialFileFormatToDownload = hasVolumes ? (isVolumeNDimensional ? "zarr3" : "wkw") : "nml";

  const [activeTabKey, setActiveTabKey] = useState<TabKeys>(initialTab ?? "download");
  const [keepWindowOpen, setKeepWindowOpen] = useState(true);
  const [fileFormatToDownload, setFileFormatToDownload] = useState<"zarr3" | "wkw" | "nml">(
    initialFileFormatToDownload,
  );
  const [selectedLayerName, setSelectedLayerName] = useState<string>(
    dataset.dataSource.dataLayers[0].name,
  );

  const layers = getDataLayers(dataset);

  const selectedLayer = getLayerByName(dataset, selectedLayerName);
  const selectedLayerInfos = getExportLayerInfos(selectedLayer, tracing);
  const selectedLayerMagInfo = getMagInfo(selectedLayer.resolutions);

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
  const [exportFormat, setExportFormat] = useState<ExportFormat>(ExportFormat.OME_TIFF);

  const selectedBoundingBox = userBoundingBoxes.find(
    (bbox) => bbox.id === selectedBoundingBoxId,
  ) as UserBoundingBox;
  const { isExportable, alerts: boundingBoxCompatibilityAlerts } = isBoundingBoxExportable(
    selectedBoundingBox.boundingBox,
    mag,
  );

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

  const handleOk = async () => {
    if (activeTabKey === "download") {
      await Model.ensureSavedState();
      const includeVolumeData = fileFormatToDownload === "wkw" || fileFormatToDownload === "zarr3";
      downloadAnnotation(
        tracing.annotationId,
        tracing.annotationType,
        hasVolumeFallback,
        {},
        fileFormatToDownload,
        includeVolumeData,
      );
      onClose();
    } else if (activeTabKey === "export" && startJob != null) {
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
    }
  };

  const maybeShowWarning = () => {
    const volumeFallbackWarning =
      activeTabKey === "download" && hasVolumeFallback ? (
        <Row key="no-fallback">
          <Text
            style={{
              margin: "0 6px 12px",
            }}
            type="warning"
          >
            {messages["annotation.no_fallback_data_included"]}
          </Text>
        </Row>
      ) : null;
    const pythonTokenWarning =
      activeTabKey === "python" ? (
        <Row key="python-token-warning">
          <Text
            style={{
              margin: "0 6px 12px",
            }}
            type="warning"
          >
            {activeUser != null
              ? messages["download.python_do_not_share"]({ typeName })
              : messages["annotation.register_for_token"]}
          </Text>
        </Row>
      ) : null;

    return [volumeFallbackWarning, pythonTokenWarning];
  };

  const handleTabChange = (key: string) => {
    setActiveTabKey(key as TabKeys);
  };

  const handleKeepWindowOpenChecked = (e: any) => {
    setKeepWindowOpen(e.target.checked);
  };

  const typeDependentFileName = isAnnotation ? "annotation files" : "datasets";
  const moreInfoHint = (
    <Hint
      style={{
        margin: "0px 12px 0px 12px",
      }}
    >
      For more information on how to work with {typeDependentFileName} visit the{" "}
      <a
        href="https://docs.webknossos.org/webknossos/data/export_ui.html"
        target="_blank"
        rel="noreferrer"
      >
        user documentation
      </a>
      .
    </Hint>
  );

  const workerInfo = (
    <Row>
      <Divider
        style={{
          margin: "18px 0",
        }}
      />
      <Text
        style={{
          margin: "0 6px 12px",
        }}
        type="warning"
      >
        {messages["annotation.export_no_worker"]}
        <a href="mailto:hello@webknossos.org">hello@webknossos.org.</a>
      </Text>
    </Row>
  );

  const radioButtonStyle = {
    marginBottom: 24,
  };

  const authToken = useFetch(
    async () => {
      if (activeUser != null) {
        return getAuthToken();
      }
      return null;
    },
    "loading...",
    [activeUser],
  );

  const wkInitSnippet = isAnnotation
    ? getPythonAnnotationDownloadSnippet(authToken, tracing)
    : getPythonDatasetDownloadSnippet(authToken, dataset);

  const alertTokenIsPrivate = () => {
    if (authToken) {
      Toast.warning(
        "The clipboard contains private data. Do not share this information with anyone you do not trust!",
      );
    }
  };

  const hasSkeleton = tracing.skeleton != null;

  const okText = okTextForTab.get(activeTabKey);
  const isCurrentlyRunningExportJob =
    activeTabKey === "export" &&
    runningExportJobs.some(([key]) => key === exportKey(selectedLayerInfos, mag));

  const isOkButtonDisabled =
    activeTabKey === "export" &&
    (!isExportable || isCurrentlyRunningExportJob || isMergerModeEnabled);

  // Will be false if no volumes exist.

  const downloadTab = (
    <>
      <Row>
        {maybeShowWarning()}
        <Text
          style={{
            margin: "0 6px 12px",
          }}
        >
          {!hasVolumes ? "This is a Skeleton-only annotation. " : ""}
          {!hasSkeleton ? "This is a Volume-only annotation. " : ""}
          {messages["annotation.download"]}
        </Text>
      </Row>
      <Divider
        style={{
          margin: "18px 0",
        }}
      >
        Options
      </Divider>
      <Row>
        <Col
          span={9}
          style={{
            lineHeight: "20px",
            padding: "5px 12px",
          }}
        >
          Select the data you would like to download.
          <Hint style={{ marginTop: 12 }}>
            An NML file will always be included with any download.
          </Hint>
        </Col>
        <Col span={15}>
          <Radio.Group
            defaultValue={initialFileFormatToDownload}
            value={fileFormatToDownload}
            onChange={(e) => setFileFormatToDownload(e.target.value)}
            style={{ marginLeft: 16 }}
          >
            {hasVolumes ? (
              <>
                <Tooltip
                  title={
                    isVolumeNDimensional ? "WKW is not supported for n-dimensional volumes." : null
                  }
                >
                  <Radio value="wkw" disabled={isVolumeNDimensional} style={radioButtonStyle}>
                    Include volume annotations as WKW
                    <Hint style={{}}>Download a zip folder containing WKW files.</Hint>
                  </Radio>
                </Tooltip>
                <Radio value="zarr3" style={radioButtonStyle}>
                  Include volume annotations as Zarr
                  <Hint style={{}}>Download a zip folder containing Zarr files.</Hint>
                </Radio>
              </>
            ) : null}
            <Radio value="nml" style={radioButtonStyle}>
              {hasSkeleton ? "Skeleton annotations" : "Meta data"} {hasVolumes ? "only " : ""}
              as NML
            </Radio>
          </Radio.Group>
        </Col>
      </Row>
      <Divider
        style={{
          margin: "18px 0",
        }}
      />
      {moreInfoHint}
    </>
  );

  const onlyOneMagAvailable = selectedLayerMagInfo.getMagList().length === 1;

  const tiffExportTab = (
    <>
      <Row>
        {maybeShowWarning()}
        <Text
          style={{
            margin: "0 6px 12px",
          }}
        >
          {messages["download.export_as_tiff"]({ typeName })}
        </Text>
      </Row>
      {activeTabKey === "export" &&
      !dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobType.EXPORT_TIFF) ? (
        workerInfo
      ) : (
        <div>
          <Divider
            style={{
              margin: "18px 0",
            }}
          >
            Export format
          </Divider>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Radio.Group value={exportFormat} onChange={(ev) => setExportFormat(ev.target.value)}>
              <Radio.Button value={ExportFormat.OME_TIFF}>OME-TIFF</Radio.Button>
              <Radio.Button value={ExportFormat.TIFF_STACK}>TIFF stack (as .zip)</Radio.Button>
            </Radio.Group>
          </div>

          <Divider
            style={{
              margin: "18px 0",
            }}
          >
            Layer
          </Divider>
          <LayerSelection
            layers={layers}
            value={selectedLayerName}
            onChange={setSelectedLayerName}
            getReadableNameForLayer={(layer) =>
              getReadableNameOfVolumeLayer(layer, tracing) || layer.name
            }
            style={{ width: "100%" }}
          />

          <Divider
            style={{
              margin: "18px 0",
            }}
          >
            Bounding Box
          </Divider>
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
          {(selectedLayerInfos.additionalAxes?.length || 0) > 0 && (
            <Row>
              <Divider
                style={{
                  margin: "18px 0",
                }}
              >
                Additional Coordinates
              </Divider>
              <Text
                style={{
                  margin: "0 6px 12px",
                }}
              >
                Your dataset has more than three dimensions. The export will only include the
                selected bounding box at the current additional dimensions:{" "}
                {getAdditionalCoordinatesAsString(currentAdditionalCoordinates)}
              </Text>
            </Row>
          )}

          <Divider
            style={{
              margin: "18px 0",
            }}
          >
            Mag
          </Divider>
          {!onlyOneMagAvailable && (
            <Row>
              <Col span={19}>
                <MagSlider magnificationInfo={selectedLayerMagInfo} value={mag} onChange={setMag} />
              </Col>
              <Col
                span={5}
                style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}
              >
                {mag.join("-")}
              </Col>
            </Row>
          )}
          <Text
            style={{
              margin: "0 6px 12px",
              display: "block",
            }}
          >
            {onlyOneMagAvailable && mag.join("-")}
            <br />
            Estimated file size:{" "}
            {estimateFileSize(selectedLayer, mag, selectedBoundingBox.boundingBox, exportFormat)}
            <br />
            Magnification: {formatSelectedScale(dataset, mag)}
          </Text>

          <Divider />
          <p>
            Go to the{" "}
            <a href="/jobs" target="_blank" rel="noreferrer">
              Jobs Overview Page
            </a>{" "}
            to see running exports and to download the results.
          </p>
        </div>
      )}
      <Divider
        style={{
          margin: "18px 0",
        }}
      />
      {moreInfoHint}
      <Checkbox
        style={{ position: "absolute", bottom: -62 }}
        checked={keepWindowOpen}
        onChange={handleKeepWindowOpenChecked}
        disabled={activeTabKey === "export" && !features().jobsEnabled}
      >
        Keep window open
      </Checkbox>
    </>
  );

  const pythonClientTab = (
    <>
      <Row>
        <Text
          style={{
            margin: "0 6px 12px",
          }}
        >
          The following code snippets are suggestions to get you started quickly with the{" "}
          <a href="https://docs.webknossos.org/webknossos-py/" target="_blank" rel="noreferrer">
            WEBKNOSSOS Python API
          </a>
          . To download and use this {typeName} in your Python project, simply copy and paste the
          code snippets to your script.
        </Text>
      </Row>
      <Divider
        style={{
          margin: "18px 0",
        }}
      >
        Code Snippets
      </Divider>
      {maybeShowWarning()}
      <Paragraph>
        <CopyableCodeSnippet code="pip install webknossos" />
        <CopyableCodeSnippet code={wkInitSnippet} onCopy={alertTokenIsPrivate} />
      </Paragraph>
      <Divider
        style={{
          margin: "18px 0",
        }}
      />
      {moreInfoHint}
    </>
  );

  const tabs: TabsProps["items"] = [
    { label: "TIFF Export", key: "export", children: tiffExportTab },
    { label: "Python Client", key: "python", children: pythonClientTab },
  ];
  if (isAnnotation) tabs.unshift({ label: "Download", key: "download", children: downloadTab });

  return (
    <Modal
      title={`Download this ${typeName}`}
      open={isOpen}
      width={600}
      footer={
        okText != null ? (
          <Button
            key="ok"
            type="primary"
            disabled={isOkButtonDisabled}
            onClick={handleOk}
            loading={isCurrentlyRunningExportJob}
          >
            {okText}
          </Button>
        ) : null
      }
      onCancel={onClose}
      style={{ overflow: "visible" }}
    >
      <Tabs activeKey={activeTabKey} onChange={handleTabChange} type="card" items={tabs} />
    </Modal>
  );
}

const DownloadModalView = makeComponentLazy(_DownloadModalView);
export default DownloadModalView;
