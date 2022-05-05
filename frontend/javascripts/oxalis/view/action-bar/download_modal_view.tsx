import { Divider, Modal, Checkbox, Row, Col, Tabs, Typography, Button, Select } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import React, { useState } from "react";
import type { APIAnnotationType } from "types/api_flow_types";
import Toast from "libs/toast";
import messages from "messages";
import Model from "oxalis/model";
import { downloadNml, getAuthToken } from "admin/admin_rest_api";
import { CheckboxValueType } from "antd/lib/checkbox/Group";
const CheckboxGroup = Checkbox.Group;
const { TabPane } = Tabs;
const { Paragraph, Text } = Typography;
const { Option } = Select;
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
  Toast.warning("Snippet copied to clipboard.");
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

export default function DownloadModalView(props: Props): JSX.Element {
  const { isVisible, onClose, annotationType, annotationId, hasVolumeFallback } = props;
  const handleOk = async () => {
    await Model.ensureSavedState();
    downloadNml(annotationId, annotationType, hasVolumeFallback);
    onClose();
  };
  const [currentFooter, setCurrentFooter] = useState<React.ReactNode>([
    <Button key="ok" type="primary" onClick={handleOk}>
      Download
    </Button>,
  ]);
  const [activeTabKey, setActiveTabKey] = useState("download");

  const maybeShowWarning = () => {
    if (activeTabKey === "download") {
      if (hasVolumeFallback) {
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
      }
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

  const handleCheckboxChange = (checkedValue: CheckboxValueType[]) => {
    console.log(checkedValue);
  };

  const handleTabChange = (key: string) => {
    setActiveTabKey(key);
    const okText = okTextForTab.get(key);
    if (okText != null) {
      setCurrentFooter([
        <Button key="ok" type="primary" onClick={handleOk}>
          {okText}
        </Button>,
      ]);
    } else {
      setCurrentFooter(null);
    }
  };

  const handleLayerSelection = (selection: string) => {
    console.log(selection);
  };

  const handleBoundingBoxSelection = (bbox: string) => {
    console.log(bbox);
  };

  const checkboxStyle = {
    height: "30px",
    lineHeight: "30px",
  };

  const authToken = getAuthToken();
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

  const selection = ["Volume", "Skeleton", "Fallback"];

  return (
    <Modal
      title="Download this Annotation"
      visible={isVisible}
      width={600}
      footer={currentFooter}
      onOk={handleOk}
      onCancel={onClose}
      style={{ overflow: "visible" }}
    >
      <Tabs activeKey={activeTabKey} onChange={handleTabChange} type="card">
        <TabPane tab="Download" key="download">
          <Row>
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
          {maybeShowWarning()}
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
                <Checkbox style={checkboxStyle} value="Volume">
                  Volume Annotations
                </Checkbox>
                <Hint
                  style={{
                    marginLeft: 24,
                    marginBottom: 12,
                  }}
                >
                  Download a zip folder containing WKW files.
                </Hint>

                <Checkbox style={checkboxStyle} value="Skeleton">
                  Skeleton Annotations
                </Checkbox>
                <Hint
                  style={{
                    marginLeft: 24,
                    marginBottom: 12,
                  }}
                >
                  Download an NML file (will always be included with a WKW download).
                </Hint>
              </CheckboxGroup>
            </Col>
          </Row>
          <Divider
            style={{
              margin: "18px 0",
            }}
          />
          <Hint
            style={{
              margin: "0px 12px 0px 12px",
            }}
          >
            For more information on how to process downloaded layers visit the{" "}
            <a
              href="https://docs.webknossos.org/api/webknossos/annotation/annotation.html"
              target="_blank"
              rel="noreferrer"
            >
              user documentation
            </a>
            .
          </Hint>
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
              <Select defaultValue="l2" style={{ width: 300 }} onChange={handleLayerSelection}>
                <Option value="l1">Layer 1 with extra information</Option>
                <Option value="l2">Layer 2</Option>
                <Option value="disabled" disabled>
                  Disabled
                </Option>
              </Select>
            </Col>
          </Row>
          <Divider
            style={{
              margin: "18px 0",
            }}
          >
            Bounding Box
          </Divider>
          {maybeShowWarning()}
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
              <Select
                defaultValue="b2"
                style={{ width: 300 }}
                onChange={handleBoundingBoxSelection}
              >
                <Option value="b1">BBox 1 with extra information</Option>
                <Option value="b2">BBox 2</Option>
                <Option value="disabled" disabled>
                  Disabled
                </Option>
              </Select>
            </Col>
          </Row>
          <Divider
            style={{
              margin: "18px 0",
            }}
          />
          <Hint
            style={{
              margin: "0px 12px 0px 12px",
            }}
          >
            For more information on how to process downloaded layers visit the{" "}
            <a
              href="https://docs.webknossos.org/api/webknossos/annotation/annotation.html"
              target="_blank"
              rel="noreferrer"
            >
              user documentation
            </a>
            .
          </Hint>
          <Checkbox style={{ position: "absolute", bottom: "16px" }} value="Fallback">
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
          <Hint
            style={{
              margin: "0px 12px 0px 12px",
            }}
          >
            For more information on how to process downloaded layers visit the{" "}
            <a
              href="https://docs.webknossos.org/api/webknossos/annotation/annotation.html#Annotation.download"
              target="_blank"
              rel="noreferrer"
            >
              user documentation
            </a>
            .
          </Hint>
        </TabPane>
      </Tabs>
    </Modal>
  );
}
