import { SettingOutlined } from "@ant-design/icons";
import type { FormProps } from "antd";
import { Card, Col, Collapse, ConfigProvider, Form, Input, InputNumber, Row, Space } from "antd";
import { KeyValuePairsFormItem } from "components/key_value_pairs";
import type React from "react";
import { ColorWKBlue } from "theme";
import { APIJobCommand } from "types/api_types";
import { useAiTrainingJobContext } from "./ai_training_job_context";

export const AiTrainingSettings: React.FC = () => {
  const {
    modelName,
    setModelName,
    comments,
    setComments,
    selectedTask,
    instanceDiameterNm,
    setInstanceDiameterNm,
    customConfiguration,
    setCustomConfiguration,
  } = useAiTrainingJobContext();

  const handleValuesChange: FormProps["onValuesChange"] = (changedValues) => {
    if ("modelName" in changedValues) {
      setModelName(changedValues.modelName);
    }
    if ("comments" in changedValues) {
      setComments(changedValues.comments);
    }
    if ("instanceDiameterNm" in changedValues) {
      setInstanceDiameterNm(changedValues.instanceDiameterNm);
    }
    if ("customConfiguration" in changedValues) {
      setCustomConfiguration(changedValues.customConfiguration);
    }
  };

  const formFields = [
    { name: ["modelName"], value: modelName },
    { name: ["comments"], value: comments },
    { name: ["instanceDiameterNm"], value: instanceDiameterNm },
    { name: ["customConfiguration"], value: customConfiguration },
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
            {selectedTask?.jobType === APIJobCommand.TRAIN_INSTANCE_MODEL && (
              <Form.Item
                name="instanceDiameterNm"
                label="Instance Diameter (nm)"
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
