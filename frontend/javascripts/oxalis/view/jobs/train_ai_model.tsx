import React from "react";
import { Alert, Form, Row, Col, Input, Button, Select, Collapse } from "antd";
import { useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import {
  getColorLayers,
  getResolutionInfo,
  getSegmentationLayerByName,
  getSegmentationLayers,
} from "oxalis/model/accessors/dataset_accessor";
import { runTraining } from "admin/admin_rest_api";
import { LayerSelection, LayerSelectionFormItem } from "components/layer_selection";
import Toast from "libs/toast";
import { Model } from "oxalis/singletons";
import { getReadableNameForLayerName } from "oxalis/model/accessors/volumetracing_accessor";
import _ from "lodash";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import { formatVoxels } from "libs/format_utils";

const { TextArea } = Input;
const FormItem = Form.Item;

enum AiModelCategory {
  EM_NEURONS = "em_neurons",
  EM_NUCLEI = "em_nuclei",
}

export function TrainAiModelTab({ onClose }: { onClose: () => void }) {
  const [form] = Form.useForm();

  const tracing = useSelector((state: OxalisState) => state.tracing);
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const onFinish = async (values: any) => {
    form.validateFields();
    await Model.ensureSavedState();
    const readableVolumeName = getReadableNameForLayerName(dataset, tracing, values.layerName);
    const segmentationLayer = getSegmentationLayerByName(dataset, values.layerName);

    await runTraining({
      trainingAnnotations: [
        {
          annotationId: tracing.annotationId,
          colorLayerName: values.imageDataLayer,
          segmentationLayerName: readableVolumeName,
          mag: getResolutionInfo(segmentationLayer.resolutions).getFinestResolution(),
        },
      ],
      name: values.modelName,
      aiModelCategory: values.modelCategory,
      workflowYaml: values.workflowYaml,
      comment: values.comment,
    });
    Toast.success("The training has successfully started.");
    onClose();
  };

  const colorLayers = getColorLayers(dataset);
  const colorLayer = colorLayers[0];

  const defaultValues = {
    modelCategory: AiModelCategory.EM_NEURONS,
    imageDataLayer: colorLayer.name,
  };

  const segmentationLayers = getSegmentationLayers(dataset);
  const fixedSelectedLayer = segmentationLayers.length === 1 ? segmentationLayers[0] : null;

  const userBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );
  const bboxesVoxelCount = _.sum(
    userBoundingBoxes.map((bbox) => new BoundingBox(bbox.boundingBox).getVolume()),
  );
  return (
    <Form onFinish={onFinish} form={form} initialValues={defaultValues} layout="vertical">
      <Row style={{ display: "grid", marginBottom: 16 }}>
        <Alert
          message="Please note that this feature is experimental. Bounding boxes are expected to have sizes that are multiple of 20×20×18 voxel."
          type="warning"
          showIcon
        />
      </Row>
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
          <Select.Option value={AiModelCategory.EM_NEURONS}>EM Neurons</Select.Option>
          <Select.Option value={AiModelCategory.EM_NUCLEI}>EM Nuclei</Select.Option>
        </Select>
      </FormItem>
      <FormItem
        hasFeedback
        name="imageDataLayer"
        label="Image Data Layer"
        hidden={colorLayers.length === 1}
        rules={[
          {
            required: true,
            message: "Please select a layer whose image data should be used for training.",
          },
        ]}
      >
        <LayerSelection layers={colorLayers} tracing={tracing} style={{ width: "100%" }} />
      </FormItem>
      <LayerSelectionFormItem
        chooseSegmentationLayer
        layers={segmentationLayers}
        fixedLayerName={fixedSelectedLayer?.name}
        tracing={tracing}
        label="Groundtruth Layer"
      />
      <Row gutter={8}>
        <Col span={24}>
          <FormItem hasFeedback name="comment" label="Comment">
            <Input />
          </FormItem>
        </Col>
      </Row>
      <Collapse
        style={{ marginBottom: 8 }}
        items={[
          {
            key: "advanced",
            label: "Advanced",
            children: (
              <FormItem name="workflowYaml" label="Workflow Description (yaml)">
                <TextArea
                  className="input-monospace"
                  autoSize={{
                    minRows: 6,
                  }}
                  style={{
                    fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
                  }}
                />
              </FormItem>
            ),
          },
        ]}
        defaultActiveKey={[]}
      />

      <FormItem hasFeedback name="dummy" label="Training Data">
        <div>
          {userBoundingBoxes.length} bounding boxes ({formatVoxels(bboxesVoxelCount)})
        </div>
      </FormItem>
      <FormItem>
        <Button
          size="large"
          type="primary"
          htmlType="submit"
          style={{
            width: "100%",
          }}
          disabled={userBoundingBoxes.length === 0}
        >
          Start Training
        </Button>
      </FormItem>
    </Form>
  );
}
