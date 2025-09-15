import { SettingOutlined } from "@ant-design/icons";
import { Card, Col, Form, Input, Row, Space } from "antd";
import type { FormProps } from "antd";
import type React from "react";
import { ShouldUseManualMatchesFormItem } from "../../action-bar/ai_job_modals/components/should_use_trees_form_item";

import { useAlignmentJobContext } from "./ai_alignment_job_context";

export const AiAlignmentSettings: React.FC = () => {
  const { newDatasetName, setNewDatasetName, shouldUseManualMatches, setShouldUseManualMatches } =
    useAlignmentJobContext();

  const handleValuesChange: FormProps["onValuesChange"] = (changedValues) => {
    if (Object.prototype.hasOwnProperty.call(changedValues, "newDatasetName")) {
      setNewDatasetName(changedValues.newDatasetName);
    }
    if (Object.prototype.hasOwnProperty.call(changedValues, "useAnnotation")) {
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
          <SettingOutlined style={{ color: "#1890ff" }} />
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
