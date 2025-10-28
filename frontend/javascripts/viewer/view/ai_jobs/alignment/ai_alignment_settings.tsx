import { SettingOutlined } from "@ant-design/icons";
import { Card, Col, Form, Input, Row, Space } from "antd";
import type { FormProps } from "antd";
import type React from "react";
import { ShouldUseManualMatchesFormItem } from "../components/should_use_trees_form_item";

import { ColorWKBlue } from "theme";
import { useAlignmentJobContext } from "./ai_alignment_job_context";

export const AiAlignmentSettings: React.FC = () => {
  const { newDatasetName, setNewDatasetName, shouldUseManualMatches, setShouldUseManualMatches } =
    useAlignmentJobContext();

  const handleValuesChange: FormProps["onValuesChange"] = (changedValues) => {
    if ("newDatasetName" in changedValues) {
      setNewDatasetName(changedValues.newDatasetName);
    }
    if ("useAnnotation" in changedValues) {
      setShouldUseManualMatches(changedValues.useAnnotation);
    }
  };

  const formFields = [
    { name: ["newDatasetName"], value: newDatasetName },
    { name: ["useAnnotation"], value: shouldUseManualMatches },
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
      </Form>
    </Card>
  );
};
