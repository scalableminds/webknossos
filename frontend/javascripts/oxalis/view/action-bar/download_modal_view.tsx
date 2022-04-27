import { Divider, Modal, Checkbox, Row, Col, Tabs, Typography, Button, Select } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import React from "react";
import type { APIAnnotationType } from "types/api_flow_types";
import Toast from "libs/toast";
import { location } from "libs/window";
import messages from "messages";
import Store from "oxalis/store";
import UrlManager from "oxalis/controller/url_manager";
import Model from "oxalis/model";
import { downloadNml } from "admin/admin_rest_api";
import { CheckboxValueType } from "antd/lib/checkbox/Group";
const CheckboxGroup = Checkbox.Group;
const { TabPane } = Tabs;
const { Paragraph } = Typography;
const { Option } = Select;
type Props = {
  isVisible: boolean;
  onOk: () => void;
  annotationType: APIAnnotationType;
  annotationId: string;
  hasVolumeFallback: boolean;
};

function Hint({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <div style={{ ...style, fontSize: 12, color: "var(--ant-text-secondary)" }}>{children}</div>
  );
}

export function getUrl(sharingToken: string, includeToken: boolean) {
  const { pathname, origin } = location;
  const hash = UrlManager.buildUrlHashJson(Store.getState());
  const query = includeToken ? `?token=${sharingToken}` : "";
  const url = `${origin}${pathname}${query}#${hash}`;
  return url;
}

export async function copyCodeToClipboard(code: string) {
  await navigator.clipboard.writeText(code);
  Toast.success("Snippet copied to clipboard.");
}

export default function DownloadModalView(props: Props) {
  const { isVisible, onOk, annotationType, annotationId, hasVolumeFallback } = props;
  const handleOk = async () => {
    await Model.ensureSavedState();
    downloadNml(annotationId, annotationType, hasVolumeFallback);

    onOk();
  };
  let modalType = "Download";

  const maybeShowWarning = () => {};

  const handleCheckboxChange = (checkedValue: CheckboxValueType[]) => {
    console.log(checkedValue);
  };

  const handleTabChange = (tab: string) => {
    modalType = tab;
    console.log(modalType);
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
  const selection = ["Volume", "Skeleton", "Fallback"];

  const moreInfoHint = (
    <Hint
      style={{
        margin: "0px 12px 0px 12px",
      }}
    >
      For more information on how to process downloaded layers visit the{" "}
      <a href="https://docs.webknossos.org" target="_blank" rel="noreferrer">
        user documentation...
      </a>
    </Hint>
  );

  const wklibsInitCode = `import webknossos as wk

with wk.webknossos_context(token="MY_TOKEN"):
    dataset = wk.Dataset.download(
        dataset_name_or_url="dataset_name",
        organization_id="my_organization",
    )
`;

  return (
    <Modal
      title="Download this Annotation"
      visible={isVisible}
      width={600}
      okText="Ok"
      onOk={handleOk}
      onCancel={onOk}
      style={{ overflow: "visible" }}
    >
      <Tabs onChange={handleTabChange} type="card">
        <TabPane tab="Download" key="1">
          <Row>
            <Col span={24}>
              <Hint
                style={{
                  margin: "6px 12px",
                }}
              >
                {messages["annotation.download"]}
              </Hint>
            </Col>
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
                  Volume as WKW
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
                  Skeleton as NML
                </Checkbox>
                <Hint
                  style={{
                    marginLeft: 24,
                    marginBottom: 12,
                  }}
                >
                  Download a zip folder containing NML files.
                </Hint>

                <Checkbox style={checkboxStyle} value="Fallback">
                  Fallback Layers
                </Checkbox>
                <Hint
                  style={{
                    marginLeft: 24,
                    marginBottom: 12,
                  }}
                >
                  Download a zip folder containing fallback layers as WKW files.
                </Hint>
              </CheckboxGroup>
            </Col>
          </Row>
          <Divider
            style={{
              margin: "18px 0",
            }}
          />
          {moreInfoHint}
        </TabPane>

        <TabPane tab="Export" key="2">
          <Row>
            <Col span={24}>
              <Hint
                style={{
                  margin: "6px 12px",
                }}
              >
                {messages["annotation.export"]}
              </Hint>
            </Col>
          </Row>
          <Divider
            style={{
              margin: "18px 0",
            }}
          >
            Layer
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
          {moreInfoHint}
          <Checkbox style={{ position: "absolute", bottom: "16px" }} value="Fallback">
            Keep window open
          </Checkbox>
        </TabPane>

        <TabPane tab="Python Client" key="3">
          <Row>
            <Col span={24}>
              <Hint
                style={{
                  margin: "6px 12px",
                }}
              >
                {messages["annotation.python"]}
              </Hint>
            </Col>
          </Row>
          <Divider
            style={{
              margin: "18px 0",
            }}
          >
            Code Snippets
          </Divider>
          <Paragraph>
            <pre>
              <Button
                style={{
                  float: "right",
                  border: "none",
                  width: "18px",
                  height: "16px",
                  background: "transparent",
                }}
                onClick={() => copyCodeToClipboard("pip install webknossos")}
                icon={<CopyOutlined />}
              />
              pip install webknossos
            </pre>
            <pre>
              <Button
                style={{
                  float: "right",
                  border: "none",
                  width: "18px",
                  height: "16px",
                  background: "transparent",
                }}
                onClick={() => copyCodeToClipboard(wklibsInitCode)}
                icon={<CopyOutlined />}
              />
              {wklibsInitCode}
            </pre>
          </Paragraph>
          <Divider
            style={{
              margin: "18px 0",
            }}
          />
          {moreInfoHint}
        </TabPane>
      </Tabs>
    </Modal>
  );
}
