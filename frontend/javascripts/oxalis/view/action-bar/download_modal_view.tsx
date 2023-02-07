import { Divider, Modal, Checkbox, Row, Col, Tabs, Typography, Button, Radio, Slider } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import { makeComponentLazy, useFetch } from "libs/react_helpers";
import type { APIAnnotationType, APIDataLayer } from "types/api_flow_types";
import Toast from "libs/toast";
import messages from "messages";
import { Model } from "oxalis/singletons";
import features from "features";
import { downloadAnnotation, getAuthToken } from "admin/admin_rest_api";
import { CheckboxValueType } from "antd/lib/checkbox/Group";
import {
  LayerSelection,
  BoundingBoxSelection,
} from "oxalis/view/right-border-tabs/starting_job_modals";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import { hasVolumeTracings } from "oxalis/model/accessors/volumetracing_accessor";
import {
  getDataLayers,
  getDatasetResolutionInfo,
  getLayerByName,
} from "oxalis/model/accessors/dataset_accessor";
import { useSelector } from "react-redux";
import type { OxalisState, UserBoundingBox } from "oxalis/store";
import {
  getLayerInfos,
  isBoundingBoxExportable,
  ExportFormat,
  estimateFileSize,
  useRunningJobs,
} from "../right-border-tabs/export_bounding_box_modal";
import { clamp, computeBoundingBoxFromBoundingBoxObject } from "libs/utils";
const CheckboxGroup = Checkbox.Group;
const { TabPane } = Tabs;
const { Paragraph, Text } = Typography;
type Props = {
  isOpen: boolean;
  onClose: () => void;
  annotationType: APIAnnotationType;
  annotationId: string;
  hasVolumeFallback: boolean;
};

export function Hint({
  children,
  style,
}: {
  children: React.ReactNode;
  style: React.CSSProperties;
}) {
  return (
    <div style={{ ...style, fontSize: 12, color: "var(--ant-text-secondary)" }}>{children}</div>
  );
}

export async function copyToClipboard(code: string) {
  await navigator.clipboard.writeText(code);
  Toast.success("Snippet copied to clipboard.");
}

export function MoreInfoHint() {
  return (
    <Hint
      style={{
        margin: "0px 12px 0px 12px",
      }}
    >
      For more information on how to work with annotation files visit the{" "}
      <a
        href="https://docs.webknossos.org/webknossos/tooling.html"
        target="_blank"
        rel="noreferrer"
      >
        user documentation
      </a>
      .
    </Hint>
  );
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

const okTextForTab = new Map([
  ["download", "Download"],
  ["export", "Start Export Job"],
  ["python", null],
]);

function Footer({
  tabKey,
  onClick,
  boundingBoxCompatible,
}: {
  tabKey: string;
  onClick: () => void;
  boundingBoxCompatible: boolean;
}) {
  const okText = okTextForTab.get(tabKey);
  return okText != null ? (
    <Button
      key="ok"
      type="primary"
      disabled={tabKey === "export" && (!features().jobsEnabled || !boundingBoxCompatible)}
      onClick={onClick}
    >
      {okText}
    </Button>
  ) : null;
}

function _DownloadModalView({
  isOpen,
  onClose,
  annotationType,
  annotationId,
  hasVolumeFallback,
}: Props): JSX.Element {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const rawUserBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );

  const [activeTabKey, setActiveTabKey] = useState("download");
  const [includeVolumeData, setIncludeVolumeData] = useState(true);
  const [keepWindowOpen, setKeepWindowOpen] = useState(false);
  const [startedExports, setStartedExports] = useState<string[]>([]);
  const [selectedLayerName, setSelectedLayerName] = useState<string>(
    dataset.dataSource.dataLayers[0].name,
  );

  const layers = getDataLayers(dataset);

  const selectedLayer = dataset.dataSource.dataLayers.find(
    (l) => l.name === selectedLayerName,
  ) as APIDataLayer;
  const selectedLayerInfos = getLayerInfos(selectedLayer, tracing);

  const userBoundingBoxes = [
    ...rawUserBoundingBoxes,
    {
      id: -1,
      name: "Full dataset",
      boundingBox: computeBoundingBoxFromBoundingBoxObject(selectedLayer.boundingBox),
      color: [255, 255, 255],
      isVisible: true,
    } as UserBoundingBox,
  ];
  const [selectedBoundingBoxId, setSelectedBoundingBoxId] = useState(userBoundingBoxes[0].id);

  const datasetResolutionInfo = getDatasetResolutionInfo(dataset);
  const { lowestResolutionIndex, highestResolutionIndex } = selectedLayerInfos;
  const [rawResolutionIndex, setResolutionIndex] = useState<number>(lowestResolutionIndex);
  const resolutionIndex = clamp(lowestResolutionIndex, rawResolutionIndex, highestResolutionIndex);
  const [exportFormat, setExportFormat] = useState<ExportFormat>(ExportFormat.OME_TIFF);

  const selectedBoundingBox = userBoundingBoxes.find(
    (bbox) => bbox.id === selectedBoundingBoxId,
  ) as UserBoundingBox;
  const boundingBoxCompatibleInfo = isBoundingBoxExportable(
    selectedBoundingBox.boundingBox,
    datasetResolutionInfo.getResolutionByIndexOrThrow(resolutionIndex),
  );

  const [runningExportJobs, triggerExportJob] = useRunningJobs();

  const handleOk = async () => {
    if (activeTabKey === "download") {
      await Model.ensureSavedState();
      downloadAnnotation(annotationId, annotationType, hasVolumeFallback, {}, includeVolumeData);
      onClose();
    } else if (activeTabKey === "export") {
      const missingSelection = selectedLayerName == null || selectedBoundingBoxId === -1;
      const basicWarning = "Starting an export job with the chosen parameters was not possible.";
      const missingSelectionWarning = " Please choose a layer and a bounding box for export.";

      if (selectedLayerName == null || selectedBoundingBoxId === -1) {
        Toast.warning(basicWarning + missingSelectionWarning);
      } else {
        const selectedLayer = getLayerByName(dataset, selectedLayerName);
        if (selectedLayer != null && selectedBoundingBox != null) {
          const layerInfos = getLayerInfos(selectedLayer, tracing);
          await triggerExportJob(
            dataset,
            selectedBoundingBox.boundingBox,
            resolutionIndex,
            layerInfos,
            exportFormat,
          );
          Toast.success("A new export job was started successfully.");
        } else {
          Toast.warning(basicWarning);
        }
      }
      if (!keepWindowOpen && !missingSelection) {
        onClose();
      }
    }
  };

  const maybeShowWarning = () => {
    if (activeTabKey === "download" && hasVolumeFallback) {
      return (
        <Row>
          <Text
            style={{
              margin: "0 6px 12px",
            }}
            type="warning"
          >
            {messages["annotation.no_fallback_data_included"]}
          </Text>
        </Row>
      );
    } else if (activeTabKey === "python") {
      return (
        <Row>
          <Text
            style={{
              margin: "0 6px 12px",
            }}
            type="warning"
          >
            {activeUser != null
              ? messages["annotation.python_do_not_share"]
              : messages["annotation.register_for_token"]}
          </Text>
        </Row>
      );
    }
    return null;
  };

  const handleTabChange = (key: string) => {
    setActiveTabKey(key);
  };

  const handleCheckboxChange = (checkedValues: CheckboxValueType[]) => {
    setIncludeVolumeData(checkedValues.includes("Volume"));
  };

  const handleKeepWindowOpenChecked = (e: any) => {
    setKeepWindowOpen(e.target.checked);
  };

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
        <a href="mailto:hello@webknossos.com">hello@webknossos.com.</a>
      </Text>
    </Row>
  );

  const checkboxStyle = {
    height: "30px",
    lineHeight: "30px",
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
  const wkInitSnippet = `import webknossos as wk

with wk.webknossos_context(
    token="${authToken || "<insert token here>"}",
    url="${window.location.origin}"
):
    annotation = wk.Annotation.download(
        "${annotationId}",
        annotation_type="${annotationType}",
    )
`;

  const alertTokenIsPrivate = () => {
    if (authToken) {
      Toast.warning(
        "The clipboard contains private data. Do not share this information with anyone you do not trust!",
      );
    }
  };

  const hasVolumes = hasVolumeTracings(tracing);
  const hasSkeleton = tracing.skeleton != null;

  return (
    <Modal
      title="Download this annotation"
      open={isOpen}
      width={600}
      footer={
        <Footer
          tabKey={activeTabKey}
          onClick={handleOk}
          boundingBoxCompatible={boundingBoxCompatibleInfo?.isExportable || false}
        />
      }
      onCancel={onClose}
      style={{ overflow: "visible" }}
    >
      <Tabs activeKey={activeTabKey} onChange={handleTabChange} type="card">
        <TabPane tab="Download" key="download">
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
            </Col>
            <Col span={15}>
              <CheckboxGroup onChange={handleCheckboxChange} defaultValue={["Volume", "Skeleton"]}>
                {hasVolumes ? (
                  <div>
                    <Checkbox
                      style={checkboxStyle}
                      value="Volume"
                      // If no skeleton is available, volume is always selected
                      checked={!hasSkeleton ? true : includeVolumeData}
                      disabled={!hasSkeleton}
                    >
                      Volume annotations as WKW
                    </Checkbox>
                    <Hint
                      style={{
                        marginLeft: 24,
                        marginBottom: 12,
                      }}
                    >
                      Download a zip folder containing WKW files.
                    </Hint>
                  </div>
                ) : null}

                <Checkbox style={checkboxStyle} value="Skeleton" checked disabled>
                  {hasSkeleton ? "Skeleton annotations" : "Meta data"} as NML
                </Checkbox>
                <Hint
                  style={{
                    marginLeft: 24,
                    marginBottom: 12,
                  }}
                >
                  An NML file will always be included with any download.
                </Hint>
              </CheckboxGroup>
            </Col>
          </Row>
          <Divider
            style={{
              margin: "18px 0",
            }}
          />
          <MoreInfoHint />
        </TabPane>

        <TabPane tab="TIFF Export" key="export">
          <Row>
            <Text
              style={{
                margin: "0 6px 12px",
              }}
            >
              {messages["annotation.export"]}
              <a href="/jobs" target="_blank" rel="noreferrer">
                Jobs Overview Page
              </a>
              .
            </Text>
          </Row>
          {activeTabKey === "export" && !features().jobsEnabled ? (
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
              <Row>
                <Col
                  span={9}
                  style={{
                    lineHeight: "20px",
                    padding: "5px 12px",
                  }}
                >
                  Select the layer you would like to prepare for export.
                </Col>
                <Col span={15}>
                  <LayerSelection
                    layers={layers}
                    value={selectedLayerName}
                    onChange={setSelectedLayerName}
                    tracing={tracing}
                    style={{ width: 330 }}
                  />
                </Col>
              </Row>
              <Divider
                style={{
                  margin: "18px 0",
                }}
              >
                Bounding Box
              </Divider>
              <Row>
                <Col
                  span={9}
                  style={{
                    lineHeight: "20px",
                    padding: "5px 12px",
                  }}
                >
                  Select a bounding box to constrain the data for export.
                </Col>
                <Col span={15}>
                  <BoundingBoxSelection
                    value={selectedBoundingBoxId}
                    userBoundingBoxes={userBoundingBoxes}
                    setSelectedBoundingBoxId={setSelectedBoundingBoxId}
                    style={{ width: 330 }}
                  />
                </Col>
                {boundingBoxCompatibleInfo?.alerts}
              </Row>

              <Divider
                style={{
                  margin: "18px 0",
                }}
              >
                Mag
              </Divider>
              <Row>
                <Col
                  span={9}
                  style={{
                    lineHeight: "20px",
                    padding: "5px 12px",
                  }}
                >
                  Select the layer you would like to prepare for export.
                </Col>
                <Col span={11}>
                  <Slider
                    tooltip={{
                      formatter: (value) =>
                        datasetResolutionInfo
                          .getResolutionByIndexOrThrow(resolutionIndex)
                          .join("-"),
                    }}
                    min={lowestResolutionIndex}
                    max={highestResolutionIndex}
                    step={1}
                    value={resolutionIndex}
                    onChange={(value) => setResolutionIndex(value)}
                  />
                  <p>
                    Estimated file size:{" "}
                    {estimateFileSize(
                      selectedLayer,
                      resolutionIndex,
                      selectedBoundingBox.boundingBox,
                      exportFormat,
                    )}
                  </p>
                </Col>
                <Col
                  span={4}
                  style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}
                >
                  {datasetResolutionInfo.getResolutionByIndexOrThrow(resolutionIndex).join("-")}
                </Col>
              </Row>
            </div>
          )}
          <Divider
            style={{
              margin: "18px 0",
            }}
          />
          <MoreInfoHint />
          <Checkbox
            style={{ position: "absolute", bottom: "16px" }}
            checked={keepWindowOpen}
            onChange={handleKeepWindowOpenChecked}
            disabled={activeTabKey === "export" && !features().jobsEnabled}
          >
            Keep window open
          </Checkbox>
        </TabPane>

        <TabPane tab="Python Client" key="python">
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
              . To download and use this annotation in your Python project, simply copy and paste
              the code snippets to your script.
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
          <MoreInfoHint />
        </TabPane>
      </Tabs>
    </Modal>
  );
}

const DownloadModalView = makeComponentLazy(_DownloadModalView);
export default DownloadModalView;
