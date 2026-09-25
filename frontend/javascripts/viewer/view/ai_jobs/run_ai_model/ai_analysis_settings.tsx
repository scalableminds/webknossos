import { getDatasetNameRules } from "admin/dataset/dataset_components";
import { APIAiModelCategory } from "admin/rest_api";
import type { FormProps } from "antd";
import { Col, Form, Input, InputNumber, Row, Select } from "antd";
import { KeyValuePairsFormItem } from "components/key_value_pairs";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox } from "libs/utils";
import type React from "react";
import { useEffect } from "react";
import { type APIDataLayer, APIJobCommand } from "types/api_types";
import { getColorLayers } from "viewer/model/accessors/dataset_accessor";
import type { UserBoundingBox } from "viewer/store";
import {
  CollapsibleSplitMergerEvaluationSettings,
  type SplitMergerEvaluationSettings,
} from "viewer/view/ai_jobs/components/collapsible_split_merger_evaluation_settings";
import {
  getBestFittingMagComparedToTrainingDS,
  isDatasetOrBoundingBoxTooSmall,
} from "viewer/view/ai_jobs/utils";
import { BoundingBoxSelector } from "../bounding_box_selector";
import { AdvancedSettings } from "../components/job_layout";
import { getFormFieldErrors } from "../components/job_requirements";
import { JobSection } from "../components/job_section";
import { colorLayerMustNotBeUint24Rule } from "../utils";
import { useRunAiModelJobContext } from "./ai_image_segmentation_job_context";

export const AiAnalysisSettings: React.FC = () => {
  const {
    selectedBoundingBox,
    setSelectedBoundingBox,
    newDatasetName,
    setNewDatasetName,
    selectedLayer,
    setSelectedLayer,
    selectedModel,
    seedGeneratorDistanceThreshold,
    setSeedGeneratorDistanceThreshold,
    isEvaluationActive,
    setIsEvaluationActive,
    splitMergerEvaluationSettings,
    setSplitMergerEvaluationSettings,
    customConfiguration,
    setCustomConfiguration,
    selectedJobType,
    setSettingsFormErrors,
    stepStatuses,
  } = useRunAiModelJobContext();
  const [form] = Form.useForm();
  const dataset = useWkSelector((state) => state.dataset);
  const colorLayers = getColorLayers(dataset);
  const activeUser = useWkSelector((state) => state.activeUser);

  const handleValuesChange: FormProps["onValuesChange"] = (changedValues, allValues) => {
    if ("newDatasetName" in changedValues) {
      setNewDatasetName(changedValues.newDatasetName);
    }
    if ("selectedLayer" in changedValues) {
      setSelectedLayer(
        colorLayers.find((l) => l.name === changedValues.selectedLayer) as APIDataLayer,
      );
    }
    if ("selectedBoundingBox" in changedValues) {
      setSelectedBoundingBox(changedValues.selectedBoundingBox);
    }
    if ("seedGeneratorDistanceThreshold" in changedValues) {
      setSeedGeneratorDistanceThreshold(changedValues.seedGeneratorDistanceThreshold);
    }
    if ("splitMergerEvaluationSettings" in allValues) {
      setSplitMergerEvaluationSettings(
        allValues.splitMergerEvaluationSettings as SplitMergerEvaluationSettings,
      );
    }
    if ("customConfiguration" in changedValues) {
      setCustomConfiguration(changedValues.customConfiguration);
    }
  };

  // Whether the bounding box is large enough depends on the model and layer, so re-check it
  // when those change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-validate when the model or layer changes
  useEffect(() => {
    if (form.getFieldValue("selectedBoundingBox") != null) {
      form.validateFields(["selectedBoundingBox"]).catch(() => {});
    }
  }, [form, selectedModel, selectedLayer]);

  // The dataset name is also filled in programmatically (e.g. when picking a model). Setting it
  // that way keeps a previous validation error, so re-check the name if it had one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-validate when the name changes
  useEffect(() => {
    if (form.getFieldError("newDatasetName").length > 0) {
      form.validateFields(["newDatasetName"]).catch(() => {});
    }
  }, [form, newDatasetName]);

  const isInstanceModel = selectedJobType === APIJobCommand.INFER_INSTANCES;
  const isNeuronModel =
    selectedModel != null && selectedModel.category === APIAiModelCategory.EM_NEURONS;

  const formFields = [
    { name: ["newDatasetName"], value: newDatasetName },
    { name: ["selectedLayer"], value: selectedLayer?.name },
    { name: ["selectedBoundingBox"], value: selectedBoundingBox },
    { name: ["seedGeneratorDistanceThreshold"], value: seedGeneratorDistanceThreshold },
    {
      name: ["splitMergerEvaluationSettings", "useSparseTracing"],
      value: splitMergerEvaluationSettings?.useSparseTracing,
    },
    {
      name: ["splitMergerEvaluationSettings", "maxEdgeLength"],
      value: splitMergerEvaluationSettings?.maxEdgeLength,
    },
    {
      name: ["splitMergerEvaluationSettings", "sparseTubeThresholdInNm"],
      value: splitMergerEvaluationSettings?.sparseTubeThresholdInNm,
    },
    {
      name: ["splitMergerEvaluationSettings", "minimumMergerPathLengthInNm"],
      value: splitMergerEvaluationSettings?.minimumMergerPathLengthInNm,
    },
    { name: ["customConfiguration"], value: customConfiguration },
  ];

  return (
    <JobSection
      step={2}
      title="Analysis settings"
      description="Where results go and which region to process."
      status={stepStatuses.settings}
    >
      <Form
        form={form}
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
              rules={getDatasetNameRules(activeUser)}
            >
              <Input placeholder={`e.g. ${dataset.name}_neurons`} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="selectedLayer"
              label="Image data layer"
              rules={[
                { required: true, message: "Please select an image data layer" },
                colorLayerMustNotBeUint24Rule,
              ]}
            >
              <Select
                style={{ width: "100%" }}
                options={colorLayers.map((l) => ({ value: l.name, label: l.name }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="selectedBoundingBox"
          label="Bounding box"
          extra="Tip: draw one with the bounding box tool in the viewport."
          rules={[
            { required: true, message: "Please select a bounding box" },
            {
              validator: async (_, value: UserBoundingBox) => {
                if (value && selectedLayer && selectedJobType) {
                  const boundingBox = computeArrayFromBoundingBox(value.boundingBox);
                  const aiModelId = selectedModel?.id;
                  const mag = await getBestFittingMagComparedToTrainingDS(
                    selectedLayer,
                    dataset.dataSource.scale,
                    selectedJobType,
                    aiModelId,
                  );
                  if (
                    isDatasetOrBoundingBoxTooSmall(boundingBox, mag, selectedLayer, selectedJobType)
                  ) {
                    return Promise.reject(
                      new Error("The bounding box is too small for the selected model."),
                    );
                  }
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <BoundingBoxSelector />
        </Form.Item>

        <AdvancedSettings hint="Custom configuration">
          <Row gutter={24}>
            {isInstanceModel && (
              <Col span={12}>
                <Form.Item
                  name="seedGeneratorDistanceThreshold"
                  label="Seed generator distance threshold (nm)"
                  tooltip="Controls the distance between two objects' centers used as a starting point (seed) for a growing segmentation. If empty, a default based on the selected model is used. It should be set to a positive value in nm, typically 10–30% of the model’s `max_distance` parameter (= diameter/thickness of the object). For larger objects, such as nuclei (~1000 nm), use higher values. For small ones, such as synaptic vesicles (~10 nm), use lower values. If set too low, objects may merge; if too high, they may split or be missed."
                >
                  <InputNumber min={0.1} suffix="nm" style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            )}
          </Row>
          <KeyValuePairsFormItem name="customConfiguration" label="Custom configuration" />

          {isNeuronModel && (
            <CollapsibleSplitMergerEvaluationSettings
              isActive={isEvaluationActive}
              setActive={setIsEvaluationActive}
            />
          )}
        </AdvancedSettings>
      </Form>
    </JobSection>
  );
};
