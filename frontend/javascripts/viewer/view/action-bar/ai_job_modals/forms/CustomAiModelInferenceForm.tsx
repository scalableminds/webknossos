import { getAiModels, runNeuronInferenceWithAiModelJob } from "admin/rest_api";
import { Form, Row, Select, Space } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useGuardedFetch } from "libs/react_helpers";
import { computeArrayFromBoundingBox } from "libs/utils";
import { useDispatch } from "react-redux";
import { APIJobType } from "types/api_types";
import { ControlModeEnum } from "viewer/constants";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import { ExperimentalInferenceAlert } from "../components/ExperimentalInferenceAlert";
import { StartJobForm } from "./StartJobForm";

export function CustomAiModelInferenceForm() {
  const dataset = useWkSelector((state) => state.dataset);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const isViewMode = useWkSelector(
    (state) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );
  const dispatch = useDispatch();

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

  return (
    <StartJobForm
      handleClose={() => dispatch(setAIJobModalStateAction("invisible"))}
      jobName={APIJobType.INFER_NEURONS}
      buttonLabel="Start inference with custom AI model"
      title="AI Inference"
      suggestedDatasetSuffix="with_custom_model"
      isBoundingBoxConfigurable
      showWorkflowYaml
      jobApiCall={async (
        { newDatasetName, selectedLayer: colorLayer, selectedBoundingBox, useCustomWorkflow },
        form,
      ) => {
        if (!selectedBoundingBox) {
          return;
        }

        const boundingBox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);

        const maybeAnnotationId = isViewMode ? {} : { annotationId };
        return runNeuronInferenceWithAiModelJob({
          ...maybeAnnotationId,
          aiModelId: form.getFieldValue("aiModel"),
          workflowYaml: useCustomWorkflow ? form.getFieldValue("workflowYaml") : undefined,
          datasetDirectoryName: dataset.directoryName,
          organizationId: dataset.owningOrganization,
          colorLayerName: colorLayer.name,
          boundingBox,
          newDatasetName: newDatasetName,
        });
      }}
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
            />
          </Form.Item>
        </>
      }
    />
  );
}
