import { SettingOutlined } from "@ant-design/icons";
import type { FormProps } from "antd";
import { Card, Col, Collapse, ConfigProvider, Form, Input, Row, Space } from "antd";
import { KeyValuePairsFormItem } from "components/key_value_pairs";
import type React from "react";
import { ColorWKBlue } from "theme";
import { ShouldUseManualMatchesFormItem } from "../components/should_use_trees_form_item";
import { useAlignmentJobContext } from "./ai_alignment_job_context";

export const AiAlignmentSettings: React.FC = () => {
  const {
    newDatasetName,
    setNewDatasetName,
    shouldUseManualMatches,
    setShouldUseManualMatches,
    customConfiguration,
    setCustomConfiguration,
  } = useAlignmentJobContext();

  const handleValuesChange: FormProps["onValuesChange"] = (changedValues) => {
    if ("newDatasetName" in changedValues) {
      setNewDatasetName(changedValues.newDatasetName);
    }
    if ("useAnnotation" in changedValues) {
      setShouldUseManualMatches(changedValues.useAnnotation);
    }
    if ("customConfiguration" in changedValues) {
      setCustomConfiguration(changedValues.customConfiguration);
    }
  };

  const formFields = [
    { name: ["newDatasetName"], value: newDatasetName },
    { name: ["useAnnotation"], value: shouldUseManualMatches },
    { name: ["customConfiguration"], value: customConfiguration },
  ];

  return (
    <Card
      type="inner"
      title={
        <Space align="center">
          <SettingOutlined style={{ color: ColorWKBlue }} />
          Alignment Settings
        </Space>
      }
    >
      <Form layout="vertical" onValuesChange={handleValuesChange} fields={formFields}>
        <Row gutter={24}>
          <Col span={12}>
            <Form.Item
              name="newDatasetName"
              label="New Dataset Name"
              rules={[{ required: true, message: "Please provide a name for the new dataset" }]}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <ShouldUseManualMatchesFormItem />
          </Col>
        </Row>

        <ConfigProvider
          theme={{
            components: {
              Collapse: { headerPadding: "12px 0px" },
            },
          }}
        >
          <Collapse ghost bordered={false}>
            <Collapse.Panel header="Advanced Settings" key="1">
              <KeyValuePairsFormItem name="customConfiguration" label="Custom Configuration" />
            </Collapse.Panel>
          </Collapse>
        </ConfigProvider>
      </Form>
    </Card>
  );
};
