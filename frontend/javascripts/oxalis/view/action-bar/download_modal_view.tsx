import { Divider, Modal, Checkbox, Row, Col, Tabs, Typography, Button } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import { useFetch } from "libs/react_helpers";
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
import { getDataLayers, getLayerByName } from "oxalis/model/accessors/dataset_accessor";
import { useSelector } from "react-redux";
import type { OxalisState } from "oxalis/store";
import { handleStartExport, getLayerInfos } from "../right-border-tabs/export_bounding_box_modal";
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

function Hint({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <div style={{ ...style, fontSize: 12, color: "var(--ant-text-secondary)" }}>{children}</div>
  );
}

export async function copyToClipboard(code: string) {
  await navigator.clipboard.writeText(code);
  Toast.success("Snippet copied to clipboard.");
}

function MoreInfoHint() {
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

function CopyableCodeSnippet({ code, onCopy }: { code: string; onCopy?: () => void }) {
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

function Footer({ tabKey, onClick }: { tabKey: string; onClick: () => void }) {
  const okText = okTextForTab.get(tabKey);
  return okText != null ? (
    <Button
      key="ok"
      type="primary"
      disabled={tabKey === "export" && !features().jobsEnabled}
      onClick={onClick}
    >
      {okText}
    </Button>
  ) : null;
}

export default function DownloadModalView(props: Props): JSX.Element {
  const { isVisible, onClose, annotationType, annotationId, hasVolumeFallback } = props;
  const userBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );
  const [activeTabKey, setActiveTabKey] = useState("download");
  const [includeVolumeData, setIncludeVolumeData] = useState(true);
  const [keepWindowOpen, setKeepWindowOpen] = useState(false);

  const tracing = useSelector((state: OxalisState) => state.tracing);
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const [startedExports, setStartedExports] = useState([]);
  const layers = getDataLayers(dataset);

  const isMergerModeEnabled = useSelector(
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'temporaryConfiguration' does not exist o... Remove this comment to see the full error message
    (state) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const activeMappingInfos = useSelector(
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'temporaryConfiguration' does not exist o... Remove this comment to see the full error message
    (state) => state.temporaryConfiguration.activeMappingByLayer,
  );

  const [selectedLayerName, setSelectedLayerName] = useState("");
  const [selectedBoundingBoxID, setSelectedBoundingBoxId] = useState(-1);

  const handleOk = async () => {
    if (activeTabKey === "download") {
      await Model.ensureSavedState();
      downloadAnnotation(annotationId, annotationType, hasVolumeFallback, {}, includeVolumeData);
      onClose();
    } else if (activeTabKey === "export") {
      const selectedLayer = getLayerByName(dataset, selectedLayerName);
      const selectedBoundingBox = userBoundingBoxes.find(
        (bbox) => bbox.id === selectedBoundingBoxID,
      );
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
        const basicWarning = "Starting an export job with the chosen parameters was not possible.";
        const missingSelectionWarning =
          selectedLayerName === "" || selectedBoundingBoxID === -1
            ? " Please choose a layer and a bounding box for export."
            : "";
        Toast.warning(basicWarning + missingSelectionWarning);
      }
      if (!keepWindowOpen) {
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
              margin: "6px 12px",
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
              margin: "6px 12px",
            }}
            type="warning"
          >
            {messages["annotation.python_do_not_share_token"]}
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
          margin: "6px 12px",
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

  const authToken = useFetch(getAuthToken, "loading...", []);
  const wkInitSnippet = `import webknossos as wk

with wk.webknossos_context(token="${authToken}"):
    annotation = wk.Annotation.download(
        "${annotationId}",
        annotation_type="${annotationType}",
        webknossos_url="${window.location.origin}"
    )
`;

  const alertTokenIsPrivate = () => {
    Toast.warning(
      "The clipboard contains private data. Do not share this information with anyone you do not trust!",
    );
  };

  const selection = ["Volume", "Skeleton"];

  return (
    <Modal
      title="Download this Annotation"
      visible={isVisible}
      width={600}
      footer={[<Footer tabKey={activeTabKey} onClick={handleOk} key="footer" />]}
      onCancel={onClose}
      style={{ overflow: "visible" }}
    >
      <Tabs activeKey={activeTabKey} onChange={handleTabChange} type="card">
        <TabPane tab="Download" key="download">
          <Row>
            {maybeShowWarning()}
            <Text
              style={{
                margin: "6px 12px",
              }}
            >
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
              <CheckboxGroup onChange={handleCheckboxChange} defaultValue={selection}>
                <Checkbox style={checkboxStyle} value="Volume" checked={includeVolumeData}>
                  Volume Annotations as WKW
                </Checkbox>
                <Hint
                  style={{
                    marginLeft: 24,
                    marginBottom: 12,
                  }}
                >
                  Download a zip folder containing WKW files.
                </Hint>

                <Checkbox style={checkboxStyle} value="Skeleton" checked disabled>
                  Skeleton Annotations as NML
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
                margin: "6px 12px",
              }}
            >
              {messages["annotation.export"]}
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
                  {/* // if hasColorLayer(s) 
                  from props.chooseSegmentationLayer*/}
                  <LayerSelection
                    layers={layers}
                    setSelectedLayerName={setSelectedLayerName}
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
                    // from props.isBoundingBoxConfigurable
                    userBoundingBoxes={userBoundingBoxes}
                    setSelectedBoundingBoxId={setSelectedBoundingBoxId}
                    style={{ width: 330 }}
                  />
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
                margin: "6px 12px",
              }}
            >
              {messages["annotation.python"]}
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
