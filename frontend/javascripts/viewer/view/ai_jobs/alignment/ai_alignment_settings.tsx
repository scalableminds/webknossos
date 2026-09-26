import { InfoCircleOutlined, SettingOutlined } from "@ant-design/icons";
import type { FormProps } from "antd";
import { Card, Checkbox, Col, Collapse, ConfigProvider, Form, Input, Row, Space } from "antd";
import FastTooltip from "components/fast_tooltip";
import { KeyValuePairsFormItem } from "components/key_value_pairs";
import type React from "react";
import { ColorWKBlue } from "theme";
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
    fineAlignmentOnly,
    setFineAlignmentOnly,
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
              <Form.Item name="fineAlignmentOnly" valuePropName="checked">
                <Checkbox>Perform fine alignment only</Checkbox>
                <FastTooltip
                  title={`Enable this if the dataset is already roughly aligned and only needs fine-tuning, rather than a full alignment from scratch. Fine alignment assumes that your dataset has no jumps larger than ${FINE_ALIGNMENT_MAX_JUMP_SIZE} voxels.`}
                >
                  <InfoCircleOutlined />
                </FastTooltip>
              </Form.Item>
              <KeyValuePairsFormItem name="customConfiguration" label="Custom Configuration" />
            </Collapse.Panel>
          </Collapse>
        </ConfigProvider>
      </Form>
    </Card>
  );
};
