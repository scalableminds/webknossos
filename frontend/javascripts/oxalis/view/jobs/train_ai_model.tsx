import React, { useState } from "react";
import { Form, Row, Col, Input, Button, Select } from "antd";
import { useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import { getColorLayers } from "oxalis/model/accessors/dataset_accessor";
import { runTraining } from "admin/admin_rest_api";
import { LayerSelection } from "components/layer_selection";

const FormItem = Form.Item;

export function TrainAiModelTab() {
  const [form] = Form.useForm();

  const tracing = useSelector((state: OxalisState) => state.tracing);
  const onFinish = async (values: any) => {
    await runTraining({
      trainingAnnotations: [
        {
          annotationId: tracing.annotationId,
          colorLayerName: values.imageDataLayer,
          segmentationLayerName: "Volume",
          mag: [1, 1, 1],
        },
      ],
      name: values.modelName,
      aiModelCategory: values.modelCategory,
      // optional comment,
      // optional workflowYaml
    });
  };

  const dataset = useSelector((state: OxalisState) => state.dataset);
  const colorLayers = getColorLayers(dataset);
  const colorLayer = colorLayers[0];
  const [selectedColorLayerName, setSelectedColorLayerName] = useState<string>(colorLayer.name);
  const defaultValues = {
    modelCategory: "em_neurons",
    imageDataLayer: colorLayer,
  };

  const userBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );
  return (
    <Form onFinish={onFinish} form={form} initialValues={defaultValues} layout="vertical">
      <Row gutter={8}>
        <Col span={24}>
          <FormItem
            hasFeedback
            name="modelName"
            label="Model Name"
            rules={[
              {
                required: true,
                message: "Please name the model that should be trained.",
              },
            ]}
          >
            <Input autoFocus />
          </FormItem>
        </Col>
      </Row>
      <FormItem
        hasFeedback
        name="modelCategory"
        label="Model Category"
        rules={[
          {
            required: true,
            message: "Please select a model category.",
          },
        ]}
      >
        <Select>
          <Select.Option value="em_neurons">EM Neurons</Select.Option>
          <Select.Option value="em_nuclei">EM Nuclei</Select.Option>
        </Select>
      </FormItem>

      <FormItem
        hasFeedback
        name="imageDataLayer"
        label="Image Data Layer"
        rules={[
          {
            required: true,
            message: "Please select a layer whose image data should be used for training.",
          },
        ]}
      >
        <LayerSelection
          layers={colorLayers}
          value={selectedColorLayerName}
          onChange={setSelectedColorLayerName}
          tracing={tracing}
          style={{ width: "100%" }}
        />
      </FormItem>

      <FormItem hasFeedback name="dummy" label="Training Data">
        <div>{userBoundingBoxes.length} bounding boxes</div>
      </FormItem>

      <FormItem>
        <Button
          size="large"
          type="primary"
          htmlType="submit"
          style={{
            width: "100%",
          }}
        >
          Start Training
        </Button>
      </FormItem>
    </Form>
  );
}
