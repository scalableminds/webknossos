import type { FormProps } from "antd";
import { Col, Form, Input, Row, Typography } from "antd";
import { KeyValuePairsFormItem } from "components/key_value_pairs";
import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import { AdvancedSettings } from "../components/job_layout";
import { getFormFieldErrors } from "../components/job_requirements";
import { JobSection } from "../components/job_section";
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
    setSettingsFormErrors,
    stepStatuses,
  } = useAlignmentJobContext();

  const dataset = useWkSelector((state) => state.dataset);

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
    <JobSection
      step={2}
      title="Alignment settings"
      description="The aligned result is written to a new dataset."
      status={stepStatuses.settings}
    >
      <Form
        layout="vertical"
        onValuesChange={handleValuesChange}
        onFieldsChange={(_, allFields) => setSettingsFormErrors(getFormFieldErrors(allFields))}
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

        <AdvancedSettings hint="Custom configuration">
          <KeyValuePairsFormItem name="customConfiguration" label="Custom configuration" />
        </AdvancedSettings>
      </Form>
    </JobSection>
  );
};
