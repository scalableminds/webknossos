import { Divider, Modal, Checkbox, Row, Col, Tabs, Typography, Button } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import { makeComponentLazy, useFetch } from "libs/react_helpers";
import type { APIAnnotationType } from "types/api_flow_types";
import Toast from "libs/toast";
import messages from "messages";
import Model from "oxalis/model";
import features from "features";
import { downloadAnnotation, getAuthToken } from "admin/admin_rest_api";
import { CheckboxValueType } from "antd/lib/checkbox/Group";
import {
  LayerSelection,
  BoundingBoxSelection,
} from "oxalis/view/right-border-tabs/starting_job_modals";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import { hasVolumeTracings } from "oxalis/model/accessors/volumetracing_accessor";
import { getDataLayers, getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { useSelector } from "react-redux";
import type { OxalisState } from "oxalis/store";
import {
  handleStartExport,
  getLayerInfos,
  isBoundingBoxExportable,
} from "../right-border-tabs/export_bounding_box_modal";
const CheckboxGroup = Checkbox.Group;
const { TabPane } = Tabs;
const { Paragraph, Text } = Typography;
type Props = {
  isVisible: boolean;
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

function _DownloadModalView(props: Props): JSX.Element {
  const { isVisible, onClose, annotationType, annotationId, hasVolumeFallback } = props;

  const [activeTabKey, setActiveTabKey] = useState("download");
  const [includeVolumeData, setIncludeVolumeData] = useState(true);
  const [keepWindowOpen, setKeepWindowOpen] = useState(false);
  const [startedExports, setStartedExports] = useState<string[]>([]);
  const [selectedLayerName, setSelectedLayerName] = useState<string | null>(null);
  const [selectedBoundingBoxID, setSelectedBoundingBoxId] = useState(-1);

  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const userBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );
  const isMergerModeEnabled = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const activeMappingInfos = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.activeMappingByLayer,
  );

  const layers = getDataLayers(dataset);

  const selectedBoundingBox = userBoundingBoxes.find((bbox) => bbox.id === selectedBoundingBoxID);
  let boundingBoxCompatibleInfo = null;
  if (selectedBoundingBox != null) {
    boundingBoxCompatibleInfo = isBoundingBoxExportable(selectedBoundingBox.boundingBox);
  }

  const handleOk = async () => {
    if (activeTabKey === "download") {
      await Model.ensureSavedState();
      downloadAnnotation(annotationId, annotationType, hasVolumeFallback, {}, includeVolumeData);
      onClose();
    } else if (activeTabKey === "export") {
      const missingSelection = selectedLayerName == null || selectedBoundingBoxID === -1;
      const basicWarning = "Starting an export job with the chosen parameters was not possible.";
      const missingSelectionWarning = " Please choose a layer and a bounding box for export.";

      if (selectedLayerName == null || selectedBoundingBoxID === -1) {
        Toast.warning(basicWarning + missingSelectionWarning);
      } else {
        const selectedLayer = getLayerByName(dataset, selectedLayerName);
        if (selectedLayer != null && selectedBoundingBox != null) {
          const layerInfos = getLayerInfos(
            selectedLayer,
            tracing,
            activeMappingInfos,
            isMergerModeEnabled,
          );
          await handleStartExport(
            dataset,
            layerInfos,
            selectedBoundingBox.boundingBox,
            startedExports,
            setStartedExports,
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
    Toast.warning(
      "The clipboard contains private data. Do not share this information with anyone you do not trust!",
    );
  };

  const hasVolumes = hasVolumeTracings(tracing);
  const hasSkeleton = tracing.skeleton != null;

  return (
    <Modal
      title="Download this annotation"
      visible={isVisible}
      width={600}
      footer={[
        <Footer
          tabKey={activeTabKey}
          onClick={handleOk}
          key="footer"
          boundingBoxCompatible={boundingBoxCompatibleInfo?.isExportable || false}
        />,
      ]}
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
              <a href="/jobs" target="_blank">
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
                    userBoundingBoxes={userBoundingBoxes}
                    setSelectedBoundingBoxId={setSelectedBoundingBoxId}
                    style={{ width: 330 }}
                  />
                </Col>
                {boundingBoxCompatibleInfo?.alerts}
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
                webKnossos Python API
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
