import { runNeuronTraining } from "admin/rest_api";
import { Alert, Button, Col, Form, type FormInstance, Input, Row, Select, Tooltip } from "antd";
import { LayerSelection, LayerSelectionFormItem } from "components/layer_selection";
import { MagSelectionFormItem } from "components/mag_selection";
import { formatVoxels } from "libs/format_utils";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import _ from "lodash";
import React, { useRef } from "react";
import type { APIAnnotation, APIDataLayer, APIDataset } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import {
  getColorLayers,
  getMagInfo,
  getSegmentationLayers,
} from "viewer/model/accessors/dataset_accessor";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import { MagInfo } from "viewer/model/helpers/mag_info";
import type { StoreAnnotation } from "viewer/store";
import { CollapsibleWorkflowYamlEditor } from "../components/collapsible_workflow_yaml_editor";
import {
  type AnnotationInfoForAITrainingJob,
  checkAnnotationsForErrorsAndWarnings,
  checkBoundingBoxesForErrorsAndWarnings,
} from "../utils";
import { AnnotationsCsvInput } from "../components/annotations_csv_input";

enum AiModelCategory {
  EM_NEURONS = "em_neurons",
  EM_NUCLEI = "em_nuclei",
}

const AiModelNameFormItem = () => (
  <Row gutter={8}>
    <Col span={24}>
      <Form.Item
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
      </Form.Item>
    </Col>
  </Row>
);

const AiModelCategoryFormItem = () => (
  <Form.Item
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
  </Form.Item>
);

const AiModelCommentFormItem = () => (
  <Row gutter={8}>
    <Col span={24}>
      <Form.Item hasFeedback name="comment" label="Comment">
        <Input />
      </Form.Item>
    </Col>
  </Row>
);

type TrainingAnnotation = {
  annotationId: string;
  imageDataLayer: string;
  layerName: string;
  mag: Vector3;
};

export function TrainAiModelForm<GenericAnnotation extends APIAnnotation | StoreAnnotation>({
  getMagsForSegmentationLayer,
  onClose,
  ensureSavedState,
  annotationInfos,
  onAddAnnotationsInfos,
}: {
  getMagsForSegmentationLayer: (annotationId: string, layerName: string) => MagInfo;
  onClose: () => void;
  ensureSavedState?: (() => Promise<void>) | null;
  annotationInfos: Array<AnnotationInfoForAITrainingJob<GenericAnnotation>>;
  onAddAnnotationsInfos?: (newItems: Array<AnnotationInfoForAITrainingJob<APIAnnotation>>) => void;
}) {
  const [form] = Form.useForm();

  const watcherFunctionRef = useRef(() => {
    return [new MagInfo([])];
  });
  watcherFunctionRef.current = () => {
    const getIntersectingMags = (idx: number, annotationId: string, dataset: APIDataset) => {
      const segmentationLayerName = form.getFieldValue(["trainingAnnotations", idx, "layerName"]);
      const imageDataLayerName = form.getFieldValue(["trainingAnnotations", idx, "imageDataLayer"]);
      if (segmentationLayerName != null && imageDataLayerName != null) {
        return new MagInfo(
          getIntersectingMagList(annotationId, dataset, segmentationLayerName, imageDataLayerName),
        );
      }
      return new MagInfo([]);
    };

    return annotationInfos.map((annotationInfo, idx: number) => {
      const annotation = annotationInfo.annotation;
      const annotationId = "id" in annotation ? annotation.id : annotation.annotationId;
      return getIntersectingMags(idx, annotationId, annotationInfo.dataset);
    });
  };

  const magInfoForLayer: Array<MagInfo> = Form.useWatch(() => {
    return watcherFunctionRef.current();
  }, form);
  const trainingAnnotationsInfo = Form.useWatch("trainingAnnotations", form) as Array<{
    annotationId: string;
    mag: Vector3;
  }>;

  const [useCustomWorkflow, setUseCustomWorkflow] = React.useState(false);

  const getIntersectingMagList = (
    annotationId: string,
    dataset: APIDataset,
    groundTruthLayerName: string,
    imageDataLayerName: string,
  ) => {
    const colorLayers = getColorLayers(dataset);
    const dataLayerMags = getMagsForColorLayer(colorLayers, imageDataLayerName);
    const groundTruthLayerMags = getMagsForSegmentationLayer(
      annotationId,
      groundTruthLayerName,
    ).getMagList();

    return groundTruthLayerMags?.filter((groundTruthMag) =>
      dataLayerMags?.find((mag) => V3.equals(mag, groundTruthMag)),
    );
  };

  const getMagsForColorLayer = (colorLayers: APIDataLayer[], layerName: string) => {
    const colorLayer = colorLayers.find((layer) => layer.name === layerName);
    return colorLayer != null ? getMagInfo(colorLayer.resolutions).getMagList() : null;
  };

  const getTrainingAnnotations = (values: any) => {
    return values.trainingAnnotations.map((trainingAnnotation: TrainingAnnotation) => {
      const { annotationId, imageDataLayer, layerName, mag } = trainingAnnotation;
      return {
        annotationId,
        colorLayerName: imageDataLayer,
        segmentationLayerName: layerName,
        mag,
      };
    });
  };

  const onFinish = async (form: FormInstance<any>, useCustomWorkflow: boolean, values: any) => {
    form.validateFields();

    // Outside of an annotation, no saving needs to happen.
    if (ensureSavedState != null) {
      await ensureSavedState();
    }

    await runNeuronTraining({
      trainingAnnotations: getTrainingAnnotations(values),
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

  const userBoundingBoxes = annotationInfos.flatMap(({ userBoundingBoxes, annotation }) => {
    const annotationId = "id" in annotation ? annotation.id : annotation.annotationId;
    return userBoundingBoxes.map((box) => ({
      ...box,
      annotationId: annotationId,
      trainingMag: trainingAnnotationsInfo?.find(
        (formInfo) => formInfo.annotationId === annotationId,
      )?.mag,
    }));
  });

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
      <AiModelNameFormItem />
      <AiModelCategoryFormItem />

      {annotationInfos.map(({ annotation, dataset }, idx) => {
        // Gather layer names from dataset. Omit the layers that are also present
        // in annotationLayers.
        const segmentationLayerNames = getSegmentationLayers(dataset)
          .map((layer) => layer.name)
          .filter(
            (tracingId) =>
              !annotation.annotationLayers.find(
                (annotationLayer) => annotationLayer.tracingId === tracingId,
              ),
          );

        // Gather layer names from the annotation
        const annotationLayerNames = annotation.annotationLayers
          .filter((layer) => layer.typ === "Volume")
          .map((layer) => layer.name);

        const segmentationAndColorLayers: Array<string> = _.uniq([
          ...segmentationLayerNames,
          ...annotationLayerNames,
        ]);
        const fixedSelectedSegmentationLayer =
          segmentationAndColorLayers.length === 1 ? segmentationAndColorLayers[0] : null;

        // Remove uint24 color layers because they cannot be trained on currently
        const colorLayers = getColorLayers(dataset).filter(
          (layer) => layer.elementClass !== "uint24",
        );
        const fixedSelectedColorLayer = colorLayers.length === 1 ? colorLayers[0] : null;
        const annotationId = "id" in annotation ? annotation.id : annotation.annotationId;

        const onChangeLayer = () => {
          form.setFieldValue(["trainingAnnotations", idx, "mag"], undefined);
        };

        return (
          <Row key={annotationId} gutter={8}>
            <Col span={6}>
              <Form.Item
                hasFeedback
                name={["trainingAnnotations", idx, "annotationId"]}
                label={<div style={{ minHeight: 24 }}>Annotation ID</div>} // balance height with labels of required fields
                initialValue={annotationId}
              >
                <Input disabled />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
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
                  onChange={onChangeLayer}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <LayerSelectionFormItem
                name={["trainingAnnotations", idx, "layerName"]}
                chooseSegmentationLayer
                layers={segmentationAndColorLayers.map((name) => ({ name }))}
                getReadableNameForLayer={(layer) => layer.name}
                fixedLayerName={fixedSelectedSegmentationLayer || undefined}
                label="Ground Truth Layer"
                onChange={onChangeLayer}
              />
            </Col>
            <Col span={6}>
              <MagSelectionFormItem
                name={["trainingAnnotations", idx, "mag"]}
                magInfo={magInfoForLayer != null ? magInfoForLayer[idx] : new MagInfo([])}
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
        <Form.Item hasFeedback label="Training Data">
          <div>
            {userBoundingBoxes.length} bounding boxes ({formatVoxels(bboxesVoxelCount)})
          </div>
        </Form.Item>
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
                whiteSpace: "pre-wrap",
              }}
              type="warning"
              showIcon
            />
          ))
        : null}

      <Form.Item>
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
      </Form.Item>
    </Form>
  );
}
