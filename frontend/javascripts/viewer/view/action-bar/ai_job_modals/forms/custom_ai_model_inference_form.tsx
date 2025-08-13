import {
  APIAiModelCategory,
  type BaseModelInferenceParameters,
  getAiModels,
  runNeuronInferenceWithAiModelJob,
  runNucleiInferenceWithAiModelJob,
} from "admin/rest_api";
import { Form, type FormInstance, InputNumber, Row, Select, Space } from "antd";
import { useGuardedFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox } from "libs/utils";
import { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import { APIJobType } from "types/api_types";
import { ControlModeEnum } from "viewer/constants";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import { ExperimentalInferenceAlert } from "../components/experimental_inference_alert";
import { type JobApiCallArgsType, StartJobForm } from "./start_job_form";

export function CustomAiModelInferenceForm() {
  const dataset = useWkSelector((state) => state.dataset);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const isViewMode = useWkSelector(
    (state) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );
  const dispatch = useDispatch();
  const [isInstanceModelSelected, setIsInstanceModelSelected] = useState(false);

  const [aiModels, isLoading] = useGuardedFetch(
    async function () {
      const models = await getAiModels();
      return models.filter(
        (aiModel) => aiModel.trainingJob == null || aiModel.trainingJob.state === "SUCCESS",
      );
    },
    [],
    [],
    "Could not load model list.",
  );

  const jobApiCallback = async (
    {
      newDatasetName,
      selectedLayer: colorLayer,
      selectedBoundingBox,
      useCustomWorkflow,
    }: JobApiCallArgsType,
    form: FormInstance,
  ) => {
    if (!selectedBoundingBox) {
      return;
    }

    const boundingBox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);
    const maybeAnnotationId = isViewMode ? {} : { annotationId };

    const commonInferenceArgs: BaseModelInferenceParameters = {
      ...maybeAnnotationId,
      aiModelId: form.getFieldValue("aiModel"),
      workflowYaml: useCustomWorkflow ? form.getFieldValue("workflowYaml") : undefined,
      datasetDirectoryName: dataset.directoryName,
      organizationId: dataset.owningOrganization,
      colorLayerName: colorLayer.name,
      boundingBox,
      newDatasetName: newDatasetName,
    };

    if (isInstanceModelSelected) {
      return runNucleiInferenceWithAiModelJob({
        ...commonInferenceArgs,
        seed_generator_distance_threshold_nm: form.getFieldValue(
          "seed_generator_distance_threshold_nm",
        ),
      });
    }
    return runNeuronInferenceWithAiModelJob(commonInferenceArgs);
  };

  const handleOnSelect = useCallback(
    (selectedModelId: string) => {
      const selectedAiModel = aiModels.find((m) => m.id === selectedModelId);

      setIsInstanceModelSelected(selectedAiModel?.category === APIAiModelCategory.EM_NUCLEI);
    },
    [aiModels],
  );

  return (
    <StartJobForm
      handleClose={() => dispatch(setAIJobModalStateAction("invisible"))}
      jobName={APIJobType.INFER_NEURONS}
      buttonLabel="Start inference with custom AI model"
      title="AI Inference"
      suggestedDatasetSuffix="with_custom_model"
      isBoundingBoxConfigurable
      showWorkflowYaml
      jobApiCall={jobApiCallback}
      description={
        <>
          <Space direction="vertical" size="middle">
            <Row style={{ display: "grid", marginBottom: 16 }}>
              <ExperimentalInferenceAlert />
            </Row>
          </Space>
          <Form.Item
            name="aiModel"
            label="Model"
            hasFeedback
            validateFirst
            rules={[{ required: true }]}
          >
            <Select
              loading={isLoading}
              options={aiModels.map((aiModel) => ({ value: aiModel.id, label: aiModel.name }))}
              onSelect={handleOnSelect}
            />
          </Form.Item>
          {isInstanceModelSelected ? (
            <Form.Item
              name="seed_generator_distance_threshold_nm"
              label="Seed generator distance threshold (nm)"
              tooltip="Controls the minimum distance in nanometers between generated seeds."
              rules={[{ required: true, message: "Please enter positive number" }]}
              initialValue={1000.0}
            >
              <InputNumber min={0.1} suffix="nm" />
            </Form.Item>
          ) : null}
        </>
      }
    />
  );
}
