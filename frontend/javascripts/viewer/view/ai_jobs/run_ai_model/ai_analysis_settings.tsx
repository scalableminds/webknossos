import { SettingOutlined } from "@ant-design/icons";
import { getDatasetNameRules } from "admin/dataset/dataset_components";
import { APIAiModelCategory } from "admin/rest_api";
import type { FormProps } from "antd";
import {
  Card,
  Col,
  Collapse,
  ConfigProvider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
} from "antd";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox } from "libs/utils";
import type React from "react";
import { ColorWKBlue } from "theme";
import type { APIDataLayer } from "types/api_types";
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
    selectedJobType,
  } = useRunAiModelJobContext();
  const dataset = useWkSelector((state) => state.dataset);
  const colorLayers = getColorLayers(dataset);
  const activeUser = useWkSelector((state) => state.activeUser);

  const handleValuesChange: FormProps["onValuesChange"] = (changedValues, allValues) => {
    if ("newDatasetName" in changedValues) {
      setNewDatasetName(changedValues.newDatasetName);
    }
    if ("selectedLayer" in changedValues) {
      setSelectedLayer(
        colorLayers.find((l) => l.name === changedValues.selectedLayer.name) as APIDataLayer,
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
  };

  const isInstanceModel = selectedModel?.category === APIAiModelCategory.EM_NUCLEI;
  const isNeuronModel = selectedModel ? !isInstanceModel : false;

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
  ];

  return (
    <Card
      type="inner"
      title={
        <Space align="center">
          <SettingOutlined style={{ color: ColorWKBlue }} />
          Analysis Settings
        </Space>
      }
    >
      <Form layout="vertical" onValuesChange={handleValuesChange} fields={formFields}>
        <Row gutter={24}>
          <Col span={12}>
            <Form.Item
              name="newDatasetName"
              label="New Dataset Name"
              rules={getDatasetNameRules(activeUser)}
            >
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="selectedLayer"
              label="Image Data Layer"
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
          label="Bounding Box"
          rules={[
            { required: true, message: "Please select a bounding box" },
            {
              validator: (_, value: UserBoundingBox) => {
                if (value && selectedLayer && selectedJobType) {
                  const boundingBox = computeArrayFromBoundingBox(value.boundingBox);

                  const mag = getBestFittingMagComparedToTrainingDS(
                    selectedLayer,
                    dataset.dataSource.scale,
                    selectedJobType,
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

        <ConfigProvider
          theme={{
            components: {
              Collapse: { headerPadding: "12px 0px" },
            },
          }}
        >
          <Collapse style={{ marginBottom: "24px" }} ghost bordered={false}>
            <Collapse.Panel header="Advanced Settings" key="1">
              <Row gutter={24}>
                {isInstanceModel && (
                  <Col span={12}>
                    <Form.Item
                      name="seedGeneratorDistanceThreshold"
                      label="Seed generator distance threshold (nm)"
                      tooltip="Controls the distance between two objects' centers used as a starting point (seed) for a growing segmentation. If empty, a default based on the selected model is used. It should be set to a positive value in nm, typically 10–30% of the model’s `max_distance` parameter (= diameter/thickness of the object). For larger objects, such as nuclei (~1000 nm), use higher values. For small ones, such as synaptic vesicles (~10 nm), use lower values. If set too low, objects may merge; if too high, they may split or be missed."
                      rules={[{ required: false, message: "Please enter a positive number" }]}
                    >
                      <InputNumber min={0.1} suffix="nm" style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                )}
              </Row>

              {isNeuronModel && (
                <CollapsibleSplitMergerEvaluationSettings
                  isActive={isEvaluationActive}
                  setActive={setIsEvaluationActive}
                />
              )}
            </Collapse.Panel>
          </Collapse>
        </ConfigProvider>
      </Form>
    </Card>
  );
};
