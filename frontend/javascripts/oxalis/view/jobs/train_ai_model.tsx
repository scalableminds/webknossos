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
import {
  AiModelTrainingAnnotationSpecification,
  getAnnotationInformation,
  getDataset,
  getTracingForAnnotationType,
  runTraining,
} from "admin/admin_rest_api";
import {
  LayerSelection,
  LayerSelectionFormItem,
  LayerSelectionFormItemForTracing,
} from "components/layer_selection";
import Toast from "libs/toast";
import { Model } from "oxalis/singletons";
import {
  getReadableNameForLayerName,
  getReadableNameOfVolumeLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import _ from "lodash";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import { formatVoxels } from "libs/format_utils";
import { V3 } from "libs/mjs";
import type {
  AnnotationLayerDescriptor,
  APIAnnotation,
  APIDataset,
  APISegmentationLayer,
  ServerVolumeTracing,
} from "types/api_flow_types";
import { getMergedDataLayersFromDatasetAndVolumeTracings } from "oxalis/model_initialization";

const { TextArea } = Input;
const FormItem = Form.Item;

export type AnnotationWithDataset = {
  annotation: APIAnnotation | HybridTracing;
  dataset: APIDataset;
  // todop
  // volumeTracings: ServerVolumeTracing[];
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

  const getTrainingAnnotations = (values: any) => {
    return values.trainingAnnotations.map(
      (trainingAnnotation: { imageDataLayer: string; layerName: string }) => {
        const { imageDataLayer, layerName } = trainingAnnotation;
        const readableVolumeName = getReadableNameForLayerName(dataset, tracing, layerName);
        const segmentationLayer = getSegmentationLayerByName(dataset, layerName);
        return {
          annotationId: tracing.annotationId,
          colorLayerName: imageDataLayer,
          segmentationLayerName: readableVolumeName,
          mag: getResolutionInfo(segmentationLayer.resolutions).getFinestResolution(),
        };
      },
    );
  };

  return (
    <TrainAiModelTab
      getTrainingAnnotations={getTrainingAnnotations}
      ensureSavedState={() => Model.ensureSavedState()}
      onClose={onClose}
      annotationsWithDatasets={[{ annotation: tracing, dataset }]}
      userBoundingBoxes={userBoundingBoxes}
    />
  );
}

export function TrainAiModelTab({
  onClose,
  getTrainingAnnotations,
  ensureSavedState,
  annotationsWithDatasets,
  userBoundingBoxes,
  onAddAnnotationsWithDatasets,
}: {
  onClose: () => void;
  getTrainingAnnotations: (values: any) => AiModelTrainingAnnotationSpecification[];
  ensureSavedState?: (() => Promise<void>) | null;
  annotationsWithDatasets: Array<AnnotationWithDataset>;
  userBoundingBoxes?: UserBoundingBox[];
  onAddAnnotationsWithDatasets?: (newItems: Array<AnnotationWithDataset>) => void;
}) {
  const [form] = Form.useForm();
  const [useCustomWorkflow, setUseCustomWorkflow] = React.useState(false);

  const onFinish = async (form: FormInstance<any>, useCustomWorkflow: boolean, values: any) => {
    form.validateFields();
    if (ensureSavedState != null) {
      await ensureSavedState();
    }

    await runTraining({
      trainingAnnotations: getTrainingAnnotations(values),
      name: values.modelName,
      aiModelCategory: values.modelCategory,
      workflowYaml: useCustomWorkflow ? values.workflowYaml : undefined,
      comment: values.comment,
    });
    Toast.success("The training has successfully started.");
    onClose();
  };

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
        const segmentationLayerNames = _.uniq([
          ...getSegmentationLayers(dataset).map((layer) => layer.name),
          ...annotation.annotationLayers
            .filter((layer) => layer.typ === "Volume")
            .map((layer) => layer.name),
        ]);
        const segmentationLayers: Array<{ name: string }> = segmentationLayerNames.map(
          (layerName) => ({
            name: layerName,
          }),
        );

        const fixedSelectedLayer = segmentationLayers.length === 1 ? segmentationLayers[0] : null;

        // Remove uint24 color layers because they cannot be trained on currently
        const colorLayers = getColorLayers(dataset).filter(
          (layer) => layer.elementClass !== "uint24",
        );
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
                  getReadableNameForLayer={(layer) => layer.name}
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
                getReadableNameForLayer={(layer) => {
                  return layer.name;
                }}
                fixedLayerName={fixedSelectedLayer?.name || undefined}
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

        const volumeTracings: ServerVolumeTracing[] = await Promise.all(
          annotation.annotationLayers
            .filter((layer) => layer.typ === "Skeleton")
            .map(
              (layer) =>
                getTracingForAnnotationType(annotation, layer) as Promise<ServerVolumeTracing>,
            ),
        );

        return {
          annotation,
          dataset,
          volumeTracings,
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
