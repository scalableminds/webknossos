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
import type { HybridTracing, OxalisState, UserBoundingBox, VolumeTracing } from "oxalis/store";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import {
  getColorLayers,
  getMagInfo,
  getSegmentationLayers,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getAnnotationInformation,
  getDataset,
  getTracingForAnnotationType,
  runTraining,
} from "admin/admin_rest_api";
import { LayerSelection, LayerSelectionFormItem } from "components/layer_selection";
import Toast from "libs/toast";
import { Model } from "oxalis/singletons";
import { getSegmentationLayerByHumanReadableName } from "oxalis/model/accessors/volumetracing_accessor";
import _ from "lodash";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import { formatVoxels } from "libs/format_utils";
import * as Utils from "libs/utils";
import type { APIAnnotation, APIDataset, ServerVolumeTracing } from "types/api_flow_types";
import type { Vector3, Vector6 } from "oxalis/constants";
import { serverVolumeToClientVolumeTracing } from "oxalis/model/reducers/volumetracing_reducer";
import { convertUserBoundingBoxesFromServerToFrontend } from "oxalis/model/reducers/reducer_helpers";
import { computeArrayFromBoundingBox } from "libs/utils";

const { TextArea } = Input;
const FormItem = Form.Item;

// This type is used for GenericAnnotation = HybridTracing | APIAnnotation as in case of multi annotation training,
// only the APIAnnotations of the given annotations to train on are loaded from the backend.
// Thus, the code needs to handle both HybridTracing | APIAnnotation where APIAnnotation is missing some information.
// Therefore, volumeTracings with the matching volumeTracingMags are needed to get more details on each volume annotation layer and its magnifications.
// The userBoundingBoxes are needed for checking for equal bounding box sizes. As training on fallback data is supported and an annotation is not required to have VolumeTracings,
// it is necessary to save userBoundingBoxes separately and not load them from volumeTracings entries to support skeleton only annotations.
// Note that a copy of the userBoundingBoxes is included in each volume and skeleton tracing of an annotation. Thus, it doesn't matter from which the userBoundingBoxes are taken.
export type AnnotationInfoForAIJob<GenericAnnotation> = {
  annotation: GenericAnnotation;
  dataset: APIDataset;
  volumeTracings: VolumeTracing[];
  userBoundingBoxes: UserBoundingBox[];
  volumeTracingMags: Vector3[][];
};

enum AiModelCategory {
  EM_NEURONS = "em_neurons",
  EM_NUCLEI = "em_nuclei",
}

const ExperimentalWarning = () => (
  <Row style={{ display: "grid", marginBottom: 16 }}>
    <Alert
      message="Please note that this feature is experimental. All bounding boxes should have equal dimensions or have dimensions which are multiples of the smallest bounding box. Ensure the size is not too small (we recommend at least 10 Vx per dimension) and choose boxes that represent the data well."
      type="info"
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

  const getMagForSegmentationLayer = async (_annotationId: string, layerName: string) => {
    const segmentationLayer = getSegmentationLayerByHumanReadableName(dataset, tracing, layerName);
    return getMagInfo(segmentationLayer.resolutions).getFinestMag();
  };
  const userBoundingBoxes = getSomeTracing(tracing).userBoundingBoxes;

  return (
    <TrainAiModelTab
      getMagForSegmentationLayer={getMagForSegmentationLayer}
      ensureSavedState={() => Model.ensureSavedState()}
      onClose={onClose}
      annotationInfos={[
        {
          annotation: tracing,
          dataset,
          volumeTracings: tracing.volumes,
          volumeTracingMags: [],
          userBoundingBoxes,
        },
      ]}
    />
  );
}

export function TrainAiModelTab<GenericAnnotation extends APIAnnotation | HybridTracing>({
  getMagForSegmentationLayer,
  onClose,
  ensureSavedState,
  annotationInfos,
  onAddAnnotationsInfos,
}: {
  getMagForSegmentationLayer: (annotationId: string, layerName: string) => Promise<Vector3>;
  onClose: () => void;
  ensureSavedState?: (() => Promise<void>) | null;
  annotationInfos: Array<AnnotationInfoForAIJob<GenericAnnotation>>;
  onAddAnnotationsInfos?: (newItems: Array<AnnotationInfoForAIJob<APIAnnotation>>) => void;
}) {
  const [form] = Form.useForm();
  const [useCustomWorkflow, setUseCustomWorkflow] = React.useState(false);

  const getTrainingAnnotations = async (values: any) => {
    return Promise.all(
      values.trainingAnnotations.map(
        async (trainingAnnotation: {
          annotationId: string;
          imageDataLayer: string;
          layerName: string;
        }) => {
          const { annotationId, imageDataLayer, layerName } = trainingAnnotation;
          return {
            annotationId,
            colorLayerName: imageDataLayer,
            segmentationLayerName: layerName,
            mag: await getMagForSegmentationLayer(annotationId, layerName),
          };
        },
      ),
    );
  };

  const onFinish = async (form: FormInstance<any>, useCustomWorkflow: boolean, values: any) => {
    form.validateFields();

    // Outside of an annotation, no saving needs to happen.
    if (ensureSavedState != null) {
      await ensureSavedState();
    }

    await runTraining({
      trainingAnnotations: await getTrainingAnnotations(values),
      name: values.modelName,
      aiModelCategory: values.modelCategory,
      workflowYaml: useCustomWorkflow ? values.workflowYaml : undefined,
      comment: values.comment,
    });
    Toast.success("The training has successfully started.");
    onClose();
  };

  if (annotationInfos.length === 0 && onAddAnnotationsInfos != null) {
    return (
      <Form form={form} layout="vertical">
        <AnnotationsCsvInput onAdd={onAddAnnotationsInfos} />
      </Form>
    );
  }

  const defaultValues = {
    modelCategory: AiModelCategory.EM_NEURONS,
  };

  const userBoundingBoxes = annotationInfos.flatMap(({ userBoundingBoxes, annotation }) =>
    userBoundingBoxes.map((box) => ({
      ...box,
      annotationId: "id" in annotation ? annotation.id : annotation.annotationId,
    })),
  );

  const bboxesVoxelCount = _.sum(
    (userBoundingBoxes || []).map((bbox) => new BoundingBox(bbox.boundingBox).getVolume()),
  );

  const { hasAnnotationErrors, errors: annotationErrors } =
    checkAnnotationsForErrorsAndWarnings(annotationInfos);
  const {
    hasBBoxErrors,
    hasBBoxWarnings,
    errors: bboxErrors,
    warnings: bboxWarnings,
  } = checkBoundingBoxesForErrorsAndWarnings(userBoundingBoxes);
  const hasErrors = hasAnnotationErrors || hasBBoxErrors;
  const hasWarnings = hasBBoxWarnings;
  const errors = [...annotationErrors, ...bboxErrors];
  const warnings = bboxWarnings;

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

      {annotationInfos.map(({ annotation, dataset, volumeTracings }, idx) => {
        const segmentationLayerNames = _.uniq([
          // Only consider the layers that are not volume layers (these aren't a fallback layer in one of the volume tracings).
          // Add actual volume layers below.
          ...getSegmentationLayers(dataset)
            .filter(
              (layer) => !volumeTracings.find((tracing) => tracing.fallbackLayer === layer.name),
            )
            .map((layer) => layer.name),
          // Add volume layers here.
          ...annotation.annotationLayers
            .filter((layer) => layer.typ === "Volume")
            .map((layer) => layer.name),
        ]);
        const segmentationLayers: Array<{ name: string }> = segmentationLayerNames.map(
          (layerName) => ({
            name: layerName,
          }),
        );

        const fixedSelectedSegmentationLayer =
          segmentationLayers.length === 1 ? segmentationLayers[0] : null;

        // Remove uint24 color layers because they cannot be trained on currently
        const colorLayers = getColorLayers(dataset).filter(
          (layer) => layer.elementClass !== "uint24",
        );
        const fixedSelectedColorLayer = colorLayers.length === 1 ? colorLayers[0] : null;
        const annotationId = "id" in annotation ? annotation.id : annotation.annotationId;
        return (
          <Row key={annotationId} gutter={8}>
            <Col span={8}>
              <FormItem
                hasFeedback
                name={["trainingAnnotations", idx, "annotationId"]}
                label="Annotation ID"
                initialValue={annotationId}
              >
                <Input disabled />
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
                  fixedLayerName={fixedSelectedColorLayer?.name || undefined}
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
                fixedLayerName={fixedSelectedSegmentationLayer?.name || undefined}
                label="Ground Truth Layer"
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
        <FormItem hasFeedback label="Training Data">
          <div>
            {userBoundingBoxes.length} bounding boxes ({formatVoxels(bboxesVoxelCount)})
          </div>
        </FormItem>
      ) : null}

      {hasErrors
        ? errors.map((error) => (
            <Alert
              key={error}
              description={error}
              style={{
                marginBottom: 12,
                whiteSpace: "pre-line",
              }}
              type="error"
              showIcon
            />
          ))
        : null}
      {hasWarnings
        ? warnings.map((warning) => (
            <Alert
              key={warning}
              description={warning}
              style={{
                marginBottom: 12,
                whiteSpace: "pre-line",
              }}
              type="warning"
              showIcon
            />
          ))
        : null}

      <FormItem>
        <Tooltip title={hasErrors ? "Solve the errors displayed above before continuing." : ""}>
          <Button
            size="large"
            type="primary"
            htmlType="submit"
            style={{
              width: "100%",
            }}
            disabled={hasErrors}
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

function checkAnnotationsForErrorsAndWarnings<T extends HybridTracing | APIAnnotation>(
  annotationsWithDatasets: Array<AnnotationInfoForAIJob<T>>,
): {
  hasAnnotationErrors: boolean;
  errors: string[];
} {
  if (annotationsWithDatasets.length === 0) {
    return {
      hasAnnotationErrors: true,
      errors: ["At least one annotation must be defined."],
    };
  }
  const annotationsWithoutBoundingBoxes = annotationsWithDatasets.filter(
    ({ userBoundingBoxes }) => {
      return userBoundingBoxes.length === 0;
    },
  );
  if (annotationsWithoutBoundingBoxes.length > 0) {
    const annotationIds = annotationsWithoutBoundingBoxes.map(({ annotation }) =>
      "id" in annotation ? annotation.id : annotation.annotationId,
    );
    return {
      hasAnnotationErrors: true,
      errors: [
        `All annotations must have at least one bounding box. Annotations without bounding boxes are:\n${annotationIds.join(", ")}`,
      ],
    };
  }
  return { hasAnnotationErrors: false, errors: [] };
}

function checkBoundingBoxesForErrorsAndWarnings(
  userBoundingBoxes: (UserBoundingBox & { annotationId: string })[],
): {
  hasBBoxErrors: boolean;
  hasBBoxWarnings: boolean;
  errors: string[];
  warnings: string[];
} {
  let hasBBoxErrors = false;
  let hasBBoxWarnings = false;
  const errors = [];
  const warnings = [];
  if (userBoundingBoxes.length === 0) {
    hasBBoxErrors = true;
    errors.push("At least one bounding box must be defined.");
  }
  // Find smallest bounding box dimensions
  const minDimensions = userBoundingBoxes.reduce(
    (min, { boundingBox: box }) => ({
      x: Math.min(min.x, box.max[0] - box.min[0]),
      y: Math.min(min.y, box.max[1] - box.min[1]),
      z: Math.min(min.z, box.max[2] - box.min[2]),
    }),
    { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY },
  );

  // Validate minimum size and multiple requirements
  type BoundingBoxWithAnnotationId = { boundingBox: Vector6; name: string; annotationId: string };
  const tooSmallBoxes: BoundingBoxWithAnnotationId[] = [];
  const nonMultipleBoxes: BoundingBoxWithAnnotationId[] = [];
  userBoundingBoxes.forEach(({ boundingBox: box, name, annotationId }) => {
    const arrayBox = computeArrayFromBoundingBox(box);
    const [_x, _y, _z, width, height, depth] = arrayBox;
    if (width < 10 || height < 10 || depth < 10) {
      tooSmallBoxes.push({ boundingBox: arrayBox, name, annotationId });
    }

    if (
      width % minDimensions.x !== 0 ||
      height % minDimensions.y !== 0 ||
      depth % minDimensions.z !== 0
    ) {
      nonMultipleBoxes.push({ boundingBox: arrayBox, name, annotationId });
    }
  });

  const boxWithIdToString = ({ boundingBox, name, annotationId }: BoundingBoxWithAnnotationId) =>
    `'${name}' of annotation ${annotationId}: ${boundingBox.join(", ")}`;

  if (tooSmallBoxes.length > 0) {
    hasBBoxWarnings = true;
    const tooSmallBoxesStrings = tooSmallBoxes.map(boxWithIdToString);
    warnings.push(
      `The following bounding boxes are not at least 10 Vx in each dimension which is suboptimal for the training:\n${tooSmallBoxesStrings.join("\n")}`,
    );
  }

  if (nonMultipleBoxes.length > 0) {
    hasBBoxWarnings = true;
    const nonMultipleBoxesStrings = nonMultipleBoxes.map(boxWithIdToString);
    warnings.push(
      `The minimum bounding box dimensions are ${minDimensions.x} x ${minDimensions.y} x ${minDimensions.z}. The following bounding boxes have dimensions which are not a multiple of the minimum dimensions which is suboptimal for the training:\n${nonMultipleBoxesStrings.join("\n")}`,
    );
  }

  return { hasBBoxErrors, hasBBoxWarnings, errors, warnings };
}

function AnnotationsCsvInput({
  onAdd,
}: {
  onAdd: (newItems: Array<AnnotationInfoForAIJob<APIAnnotation>>) => void;
}) {
  const [value, setValue] = useState("");
  const onClickAdd = async () => {
    const newItems = [];

    const lines = value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    for (const annotationUrlOrId of lines) {
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
        const dataset = await getDataset(annotation.datasetId);

        const volumeServerTracings: ServerVolumeTracing[] = await Promise.all(
          annotation.annotationLayers
            .filter((layer) => layer.typ === "Volume")
            .map(
              (layer) =>
                getTracingForAnnotationType(annotation, layer) as Promise<ServerVolumeTracing>,
            ),
        );
        const volumeTracings = volumeServerTracings.map((tracing) =>
          serverVolumeToClientVolumeTracing(tracing),
        );
        // A copy of the user bounding boxes of an annotation is saved in every tracing. In case no volume tracing exists, the skeleton tracing is checked.
        let userBoundingBoxes = volumeTracings[0]?.userBoundingBoxes;
        if (!userBoundingBoxes) {
          const skeletonLayer = annotation.annotationLayers.find(
            (layer) => layer.typ === "Skeleton",
          );
          if (skeletonLayer) {
            const skeletonTracing = await getTracingForAnnotationType(annotation, skeletonLayer);
            userBoundingBoxes = convertUserBoundingBoxesFromServerToFrontend(
              skeletonTracing.userBoundingBoxes,
            );
          } else {
            throw new Error(
              `Annotation ${annotation.id} has neither a volume nor a skeleton layer`,
            );
          }
        }

        return {
          annotation,
          dataset,
          volumeTracings,
          volumeTracingMags: volumeServerTracings.map(({ mags }) =>
            mags ? mags.map(Utils.point3ToVector3) : ([[1, 1, 1]] as Vector3[]),
          ),
          userBoundingBoxes: userBoundingBoxes || [],
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
        initialValue={value}
        rules={[
          () => ({
            validator: (_rule, value) => {
              const valid = (value as string)
                .split("\n")
                .every((line) => !line.includes("#") && !line.includes(","));

              return valid
                ? Promise.resolve()
                : Promise.reject(
                    new Error(
                      "Each line should only contain an annotation ID or URL (without # or ,)",
                    ),
                  );
            },
          }),
        ]}
      >
        <TextArea
          className="input-monospace"
          placeholder="annotationUrlOrId"
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
