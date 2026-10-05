import { InfoCircleOutlined } from "@ant-design/icons";
import type { FormProps } from "antd";
import { Checkbox, Col, Form, Input, Row, Space, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import { KeyValuePairsFormItem } from "components/key_value_pairs";
import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useEffect } from "react";
import { AdvancedSettings } from "../components/job_layout";
import { getFormValidationState } from "../components/job_requirements";
import { JobSection } from "../components/job_section";
import { ShouldUseManualMatchesFormItem } from "../components/should_use_trees_form_item";
import { FINE_ALIGNMENT_MAX_JUMP_SIZE, useAlignmentJobContext } from "./ai_alignment_job_context";

export const AiAlignmentSettings: React.FC = () => {
  const {
    newDatasetName,
    setNewDatasetName,
    shouldUseManualMatches,
    setShouldUseManualMatches,
    customConfiguration,
    setCustomConfiguration,
    setSettingsFormState,
    stepStatuses,
    fineAlignmentOnly,
    setFineAlignmentOnly,
  } = useAlignmentJobContext();

  const [form] = Form.useForm();
  const dataset = useWkSelector((state) => state.dataset);

  // The dataset name is also filled in programmatically (e.g. when picking a model). Setting it
  // that way keeps a previous validation error, so re-check the name if it had one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-validate when the name changes
  useEffect(() => {
    if (form.getFieldError("newDatasetName").length > 0) {
      form.validateFields(["newDatasetName"]).catch(() => {});
    }
  }, [form, newDatasetName]);

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
    if ("fineAlignmentOnly" in changedValues) {
      setFineAlignmentOnly(changedValues.fineAlignmentOnly);
    }
  };

  const formFields = [
    { name: ["newDatasetName"], value: newDatasetName },
    { name: ["useAnnotation"], value: shouldUseManualMatches },
    { name: ["customConfiguration"], value: customConfiguration },
    { name: ["fineAlignmentOnly"], value: fineAlignmentOnly },
  ];

  return (
    <JobSection
      step={2}
      title="Alignment Settings"
      description="The aligned result is written to a new dataset."
      status={stepStatuses.settings}
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={handleValuesChange}
        onFieldsChange={(_, allFields) => setSettingsFormState(getFormValidationState(allFields))}
        fields={formFields}
      >
        <Row gutter={24}>
          <Col span={12}>
            <Form.Item
              name="newDatasetName"
              label="New dataset name"
              rules={[{ required: true, message: "Please provide a name for the new dataset" }]}
            >
              <Input placeholder={`e.g. ${dataset.name}_aligned`} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <ShouldUseManualMatchesFormItem />
          </Col>
        </Row>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          Optional: connected skeleton nodes between adjacent sections are used as alignment guides.
        </Typography.Paragraph>

        <AdvancedSettings hint="Fine alignment, custom configuration">
          <Form.Item>
            <Space>
              <Form.Item name="fineAlignmentOnly" valuePropName="checked" noStyle>
                <Checkbox>Perform fine alignment only</Checkbox>
              </Form.Item>
              <FastTooltip
                title={`Enable this if the dataset is already roughly aligned and only needs fine-tuning, rather than a full alignment from scratch. Fine alignment assumes that no major rotations or jumps larger than ${FINE_ALIGNMENT_MAX_JUMP_SIZE} voxels need to be solved.`}
              >
                <InfoCircleOutlined />
              </FastTooltip>
            </Space>
          </Form.Item>
          <KeyValuePairsFormItem name="customConfiguration" label="Custom configuration" />
        </AdvancedSettings>
      </Form>
    </JobSection>
  );
};
