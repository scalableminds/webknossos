import React, { useState } from "react";
import {
  Alert,
  Form,
  Row,
  Col,
  Input,
  Button,
  Select,
  Collapse,
  Tooltip,
  Checkbox,
  type FormInstance,
} from "antd";
import { useSelector } from "react-redux";
import type { HybridTracing, OxalisState, UserBoundingBox } from "oxalis/store";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import {
  getColorLayers,
  getResolutionInfo,
  getSegmentationLayerByName,
  getSegmentationLayers,
} from "oxalis/model/accessors/dataset_accessor";
import { getAnnotationInformation, getDataset, runTraining } from "admin/admin_rest_api";
import { LayerSelection, LayerSelectionFormItem } from "components/layer_selection";
import Toast from "libs/toast";
import { Model } from "oxalis/singletons";
import { getReadableNameForLayerName } from "oxalis/model/accessors/volumetracing_accessor";
import _ from "lodash";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import { formatVoxels } from "libs/format_utils";
import { V3 } from "libs/mjs";
import type { APIAnnotation, APIDataset } from "types/api_flow_types";

const { TextArea } = Input;
const FormItem = Form.Item;

export type AnnotationWithDataset = {
  annotation: APIAnnotation | HybridTracing;
  dataset: APIDataset;
};

enum AiModelCategory {
  EM_NEURONS = "em_neurons",
  EM_NUCLEI = "em_nuclei",
}

const ExperimentalWarning = () => (
  <Row style={{ display: "grid", marginBottom: 16 }}>
    <Alert
      message="Please note that this feature is experimental. All bounding boxes must be the same size, with equal width and height. Ensure the size is not too small (we recommend at least 10 Vx per dimension) and choose boxes that represent the data well."
      type="warning"
      showIcon
    />
  </Row>
);

const AiModelNameFormItem = () => (
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
);

const AiModelCategoryFormItem = () => (
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
);

const AiModelCommentFormItem = () => (
  <Row gutter={8}>
    <Col span={24}>
      <FormItem hasFeedback name="comment" label="Comment">
        <Input />
      </FormItem>
    </Col>
  </Row>
);

export function TrainAiModelFromAnnotationTab({ onClose }: { onClose: () => void }) {
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const userBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );
  const onFinish = async (form: FormInstance<any>, useCustomWorkflow: boolean, values: any) => {
    form.validateFields();
    await Model.ensureSavedState();
    const readableVolumeName = getReadableNameForLayerName(dataset, tracing, values.layerName);
    const segmentationLayer = getSegmentationLayerByName(dataset, values.layerName);
    const colorLayer = getColorLayers(dataset).find(
      (layer) => layer.name === values.imageDataLayer,
    );
    if (colorLayer?.elementClass === "uint24") {
      const errorMessage =
        "AI training jobs can not be started for color layers with the data type uInt24. Please select a color layer with another data type.";
      Toast.error(errorMessage);
      console.error(errorMessage);
      return;
    }

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
      workflowYaml: useCustomWorkflow ? values.workflowYaml : undefined,
      comment: values.comment,
    });
    Toast.success("The training has successfully started.");
    onClose();
  };

  return (
    <TrainAiModelTab
      onFinish={onFinish}
      annotationsWithDatasets={[{ annotation: tracing, dataset }]}
      userBoundingBoxes={userBoundingBoxes}
    />
  );
}

export function TrainAiModelTab({
  onFinish,
  annotationsWithDatasets,
  userBoundingBoxes,
  onAddAnnotationsWithDatasets,
}: {
  onFinish: (form: FormInstance<any>, useCustomWorkflow: boolean, values: any) => void;
  annotationsWithDatasets: Array<AnnotationWithDataset>;
  userBoundingBoxes?: UserBoundingBox[];
  onAddAnnotationsWithDatasets?: (newItems: Array<AnnotationWithDataset>) => void;
}) {
  const [form] = Form.useForm();
  const [useCustomWorkflow, setUseCustomWorkflow] = React.useState(false);

  if (annotationsWithDatasets.length === 0 && onAddAnnotationsWithDatasets != null) {
    return (
      <Form form={form} layout="vertical">
        <AnnotationsCsvInput onAdd={onAddAnnotationsWithDatasets} />
      </Form>
    );
  }

  const defaultValues = {
    modelCategory: AiModelCategory.EM_NEURONS,
    // todop
    // imageDataLayer: colorLayer.name,
  };

  const bboxesVoxelCount = _.sum(
    (userBoundingBoxes || []).map((bbox) => new BoundingBox(bbox.boundingBox).getVolume()),
  );

  const { valid, reason } = areBoundingBoxesValid(userBoundingBoxes);

  return (
    <Form
      onFinish={(values) => onFinish(form, useCustomWorkflow, values)}
      form={form}
      initialValues={defaultValues}
      layout="vertical"
    >
      <ExperimentalWarning />
      <AiModelNameFormItem />
      <AiModelCategoryFormItem />

      {annotationsWithDatasets.map(({ annotation, dataset }, idx) => {
        const segmentationLayers = getSegmentationLayers(dataset);

        const fixedSelectedLayer = segmentationLayers.length === 1 ? segmentationLayers[0] : null;

        const colorLayers = getColorLayers(dataset);
        const annotationId = "id" in annotation ? annotation.id : annotation.annotationId;
        return (
          <Row key={annotationId} gutter={8}>
            <Col span={8}>
              <FormItem hasFeedback label="Annotation ID">
                <Input value={annotationId} disabled />
              </FormItem>
            </Col>
            <Col span={8}>
              <FormItem
                hasFeedback
                name={["trainingAnnotations", idx, "imageDataLayer"]}
                label="Image Data Layer"
                initialValue={colorLayers.length > 0 ? colorLayers[0].name : undefined}
                rules={[
                  {
                    required: true,
                    message: "Please select a layer whose image data should be used for training.",
                  },
                ]}
              >
                <LayerSelection
                  layers={colorLayers}
                  tracing={annotation}
                  fixedLayerName={colorLayers.length === 1 ? colorLayers[0].name : undefined}
                  style={{ width: "100%" }}
                />
              </FormItem>
            </Col>
            <Col span={8}>
              <LayerSelectionFormItem
                name={["trainingAnnotations", idx, "layerName"]}
                chooseSegmentationLayer
                layers={segmentationLayers}
                fixedLayerName={fixedSelectedLayer?.name}
                tracing={annotation}
                label="Groundtruth Layer"
              />
            </Col>
          </Row>
        );
      })}

      <AiModelCommentFormItem />
      <CollapsibleWorkflowYamlEditor
        isActive={useCustomWorkflow}
        setActive={setUseCustomWorkflow}
      />

      {userBoundingBoxes != null ? (
        <FormItem hasFeedback name="dummy" label="Training Data">
          <div>
            {userBoundingBoxes.length} bounding boxes ({formatVoxels(bboxesVoxelCount)})
          </div>
        </FormItem>
      ) : null}
      <FormItem>
        <Tooltip title={reason}>
          <Button
            size="large"
            type="primary"
            htmlType="submit"
            style={{
              width: "100%",
            }}
            disabled={!valid}
          >
            Start Training
          </Button>
        </Tooltip>
      </FormItem>
    </Form>
  );
}

export function CollapsibleWorkflowYamlEditor({
  isActive = false,
  setActive,
}: { isActive: boolean; setActive: (active: boolean) => void }) {
  return (
    <Collapse
      style={{ marginBottom: 8 }}
      onChange={() => setActive(!isActive)}
      expandIcon={() => <Checkbox checked={isActive} />}
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
      activeKey={isActive ? "advanced" : []}
    />
  );
}

function areBoundingBoxesValid(userBoundingBoxes: UserBoundingBox[] | undefined): {
  valid: boolean;
  reason: string | null;
} {
  if (userBoundingBoxes == null) {
    return { valid: true, reason: null };
  }
  if (userBoundingBoxes.length === 0) {
    return { valid: false, reason: "At least one bounding box must be defined." };
  }
  const getSize = (bbox: UserBoundingBox) => V3.sub(bbox.boundingBox.max, bbox.boundingBox.min);

  const size = getSize(userBoundingBoxes[0]);
  // width must equal height
  if (size[0] !== size[1]) {
    return { valid: false, reason: "The bounding box width must equal its height." };
  }
  // all bounding boxes must have the same size
  const areSizesIdentical = userBoundingBoxes.every((bbox) => V3.isEqual(getSize(bbox), size));
  if (areSizesIdentical) {
    return { valid: true, reason: "" };
  }
  return { valid: false, reason: "All bounding boxes must have the same size." };
}

function AnnotationsCsvInput({
  onAdd,
}: {
  onAdd: (newItems: Array<AnnotationWithDataset>) => void;
}) {
  const [value, setValue] = useState(
    "http://localhost:9000/annotations/66def487300100170c2d6fc0\n66def487300100170c2d6fc0",
  );
  const onClickAdd = async () => {
    const newItems = [];

    const lines = value.split("\n");
    for (const line of lines) {
      const [annotationUrlOrId] = line.trim().split(",");
      if (annotationUrlOrId.includes("/")) {
        newItems.push({
          annotationId: annotationUrlOrId.split("/").at(-1) as string,
        });
      } else {
        newItems.push({
          annotationId: annotationUrlOrId,
        });
      }
    }

    const newAnnotationsWithDatasets = await Promise.all(
      newItems.map(async (item) => {
        const annotation = await getAnnotationInformation(item.annotationId);
        const dataset = await getDataset({
          owningOrganization: annotation.organization,
          name: annotation.dataSetName,
        });

        return {
          annotation,
          dataset,
        };
      }),
    );

    onAdd(newAnnotationsWithDatasets);
  };
  return (
    <div>
      <FormItem
        name="annotationCsv"
        label="Annotations CSV"
        hasFeedback
        // todop
        // rules={[
        //   () => ({
        //     validator: (_rule, value) => {
        //       const tasks = parseText(value);
        //       const invalidTaskIndices = getInvalidTaskIndices(tasks);
        //       return _.isString(value) && invalidTaskIndices.length === 0
        //         ? Promise.resolve()
        //         : Promise.reject(
        //             new Error(
        //               `${
        //                 Messages["task.bulk_create_invalid"]
        //               } Error in line ${invalidTaskIndices.join(", ")}`,
        //             ),
        //           );
        //     },
        //   }),
        // ]}
      >
        <TextArea
          className="input-monospace"
          placeholder="annotationUrlOrId[, colorLayerName, volumeLayerId]"
          autoSize={{
            minRows: 6,
          }}
          style={{
            fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
          }}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </FormItem>
      <Button type="primary" onClick={onClickAdd}>
        Add
      </Button>
    </div>
  );
}
