import { startNeuronInferralJob } from "admin/rest_api";
import { type FormInstance, Row, Space } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { computeArrayFromBoundingBox } from "libs/utils";
import messages from "messages";
import React, { useCallback } from "react";
import { useDispatch } from "react-redux";
import { APIJobCommand } from "types/api_types";
import { hasEmptyTrees } from "viewer/model/accessors/skeletontracing_accessor";
import {
  getTaskBoundingBoxes,
  getUserBoundingBoxesFromState,
} from "viewer/model/accessors/tracing_accessor";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import {
  CollapsibleSplitMergerEvaluationSettings,
  type SplitMergerEvaluationSettings,
} from "../components/collapsible_split_merger_evaluation_settings";
import { ExperimentalInferenceAlert } from "../components/experimental_inference_alert";
import { getBestFittingMagComparedToTrainingDS, isDatasetOrBoundingBoxTooSmall } from "../utils";
import { type JobApiCallArgsType, StartJobForm } from "./start_job_form";

export function NeuronSegmentationForm() {
  const dataset = useWkSelector((state) => state.dataset);
  const { neuronInferralCostPerGVx } = features();
  const skeletonAnnotation = useWkSelector((state) => state.annotation.skeleton);
  const datasetConfiguration = useWkSelector((state) => state.datasetConfiguration);
  const dispatch = useDispatch();
  const [doSplitMergerEvaluation, setDoSplitMergerEvaluation] = React.useState(false);

  const userBoundingBoxCount = useWkSelector(
    (state) => getUserBoundingBoxesFromState(state).length,
  );
  const taskBoundingBoxes = useWkSelector(getTaskBoundingBoxes);

  const handleClose = useCallback(
    () => dispatch(setAIJobModalStateAction("invisible")),
    [dispatch],
  );
  const jobApiCall = useCallback(
    async (
      {
        newDatasetName,
        selectedLayer: colorLayer,
        selectedBoundingBox,
        annotationId,
      }: JobApiCallArgsType,
      form: FormInstance,
    ) => {
      const splitMergerEvaluationSettings = form.getFieldValue(
        "splitMergerEvaluationSettings",
      ) as SplitMergerEvaluationSettings;
      if (!selectedBoundingBox || (doSplitMergerEvaluation && !splitMergerEvaluationSettings)) {
        return;
      }

      const bbox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);
      const mag = getBestFittingMagComparedToTrainingDS(
        colorLayer,
        dataset.dataSource.scale,
        APIJobCommand.INFER_NEURONS,
      );
      if (isDatasetOrBoundingBoxTooSmall(bbox, mag, colorLayer, APIJobCommand.INFER_NEURONS)) {
        return;
      }
      const layerConfiguration = datasetConfiguration.layers[colorLayer.name];

      if (!doSplitMergerEvaluation) {
        return startNeuronInferralJob(
          dataset.id,
          colorLayer.name,
          bbox,
          newDatasetName,
          layerConfiguration.isInverted,
          doSplitMergerEvaluation,
        );
      }

      if (userBoundingBoxCount > 1) {
        Toast.error(messages["jobs.wrongNumberOfBoundingBoxes"]);
        return;
      }

      if (Object.values(taskBoundingBoxes).length + userBoundingBoxCount !== 1) {
        Toast.error(messages["jobs.wrongNumberOfBoundingBoxes"]);
        return;
      }

      if (skeletonAnnotation == null || skeletonAnnotation.trees.size() === 0) {
        Toast.error("Please ensure that a skeleton tree exists within the selected bounding box.");
        return;
      }
      if (hasEmptyTrees(skeletonAnnotation.trees)) {
        Toast.error("Please ensure that all skeleton trees in this annotation have some nodes.");
        return;
      }
      return startNeuronInferralJob(
        dataset.id,
        colorLayer.name,
        bbox,
        newDatasetName,
        layerConfiguration.isInverted,
        doSplitMergerEvaluation,
        annotationId,
        splitMergerEvaluationSettings,
      );
    },
    [
      dataset,
      doSplitMergerEvaluation,
      userBoundingBoxCount,
      taskBoundingBoxes,
      skeletonAnnotation,
      datasetConfiguration,
    ],
  );

  return (
    <StartJobForm
      handleClose={handleClose}
      jobName={APIJobCommand.INFER_NEURONS}
      buttonLabel="Start AI neuron segmentation"
      title="AI Neuron Segmentation"
      suggestedDatasetSuffix="with_reconstructed_neurons"
      isBoundingBoxConfigurable
      jobCreditCostPerGVx={neuronInferralCostPerGVx}
      jobApiCall={jobApiCall}
      description={
        <>
          <Space direction="vertical" size="middle">
            <Row>
              This pre-trained AI model will automatically detect and segment all neurons in this
              dataset. It is optimized for analyzing EM tissue, e.g. from FIB-SEM, MSEM,
              Serial-Section SEM etc. WEBKNOSSOS will create a copy of this dataset and add the
              resulting neuron segmentation to it.
            </Row>
            <Row style={{ display: "grid", marginBottom: 16 }}>
              <ExperimentalInferenceAlert />
            </Row>
          </Space>
        </>
      }
      jobSpecificInputFields={
        skeletonAnnotation != null && (
          <CollapsibleSplitMergerEvaluationSettings
            isActive={doSplitMergerEvaluation}
            setActive={setDoSplitMergerEvaluation}
          />
        )
      }
    />
  );
}
