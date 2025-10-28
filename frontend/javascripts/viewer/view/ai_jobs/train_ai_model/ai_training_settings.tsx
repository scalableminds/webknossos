import { SettingOutlined } from "@ant-design/icons";
import { Card, Col, Form, Input, InputNumber, Row, Space } from "antd";
import type { FormProps } from "antd";
import type React from "react";
import { APIJobType } from "types/api_types";

import { ColorWKBlue } from "theme";
import { useAiTrainingJobContext } from "./ai_training_job_context";

export const AiTrainingSettings: React.FC = () => {
  const {
    modelName,
    setModelName,
    comments,
    setComments,
    selectedTask,
    maxDistanceNm,
    setMaxDistanceNm,
  } = useAiTrainingJobContext();

  const handleValuesChange: FormProps["onValuesChange"] = (changedValues) => {
    if ("modelName" in changedValues) {
      setModelName(changedValues.modelName);
    }
    if ("comments" in changedValues) {
      setComments(changedValues.comments);
    }
    if ("maxDistanceNm" in changedValues) {
      setMaxDistanceNm(changedValues.maxDistanceNm);
    }
  };

  const formFields = [
    { name: ["modelName"], value: modelName },
    { name: ["comments"], value: comments },
    { name: ["maxDistanceNm"], value: maxDistanceNm },
  ];

  return (
    <Card
      type="inner"
      title={
        <Space align="center">
          <SettingOutlined style={{ color: ColorWKBlue }} />
          Training Settings
        </Space>
      }
    >
      <Form layout="vertical" onValuesChange={handleValuesChange} fields={formFields}>
        <Row gutter={24}>
          <Col span={12}>
            <Form.Item
              name="modelName"
              label="Model Name"
              rules={[{ required: true, message: "Please provide a name for the new model" }]}
            >
              <Input />
            </Form.Item>
            {selectedTask?.jobType === APIJobType.TRAIN_INSTANCE_MODEL && (
              <Form.Item
                name="maxDistanceNm"
                label="Max Distance (nm)"
                rules={[{ required: true, message: "Please enter a positive number" }]}
                tooltip='The maximum cross-section length ("diameter") for each identified object in nm e.g. Nuclei: 1000nm, Vesicles: 80nm'
              >
                <InputNumber min={0.1} suffix="nm" />
              </Form.Item>
            )}
          </Col>
          <Col span={12}>
            <Form.Item name="comments" label="Comments">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Card>
  );
};
