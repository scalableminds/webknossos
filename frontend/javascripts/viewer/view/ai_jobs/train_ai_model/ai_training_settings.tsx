import type { FormProps } from "antd";
import { Col, Form, Input, InputNumber, Row } from "antd";
import { KeyValuePairsFormItem } from "components/key_value_pairs";
import type React from "react";
import { APIJobCommand } from "types/api_types";
import { AdvancedSettings } from "../components/job_layout";
import { JobSection } from "../components/job_section";
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
    stepStatuses,
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
    <JobSection
      step={3}
      title="Training settings"
      description="Name the resulting model and configure its training."
      status={stepStatuses.settings}
    >
      <Form layout="vertical" onValuesChange={handleValuesChange} fields={formFields}>
        <Row gutter={24}>
          <Col span={12}>
            <Form.Item
              name="modelName"
              label="Model name"
              rules={[{ required: true, message: "Please provide a name for the new model" }]}
            >
              <Input placeholder="e.g. l4_neurons_v2" />
            </Form.Item>
            {selectedTask?.jobType === APIJobCommand.TRAIN_INSTANCE_MODEL && (
              <Form.Item
                name="instanceDiameterNm"
                label="Instance diameter (nm)"
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

        <AdvancedSettings hint="Custom configuration">
          <KeyValuePairsFormItem name="customConfiguration" label="Custom configuration" />
        </AdvancedSettings>
      </Form>
    </JobSection>
  );
};
