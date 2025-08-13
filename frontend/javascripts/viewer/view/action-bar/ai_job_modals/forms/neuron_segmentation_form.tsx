import { startNeuronInferralJob } from "admin/rest_api";
import { type FormInstance, Row, Space } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { computeArrayFromBoundingBox } from "libs/utils";
import messages from "messages";
import React from "react";
import { useDispatch } from "react-redux";
import { APIJobType } from "types/api_types";
import { hasEmptyTrees } from "viewer/model/accessors/skeletontracing_accessor";
import {
  getTaskBoundingBoxes,
  getUserBoundingBoxesFromState,
} from "viewer/model/accessors/tracing_accessor";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import { Store } from "viewer/singletons";
import {
  CollapsibleSplitMergerEvaluationSettings,
  type SplitMergerEvaluationSettings,
} from "../components/collapsible_split_merger_evaluation_settings";
import { ExperimentalInferenceAlert } from "../components/experimental_inference_alert";
import { getBestFittingMagComparedToTrainingDS, isDatasetOrBoundingBoxTooSmall } from "../utils";
import { StartJobForm } from "./start_job_form";

export function NeuronSegmentationForm() {
  const dataset = useWkSelector((state) => state.dataset);
  const { neuronInferralCostPerGVx } = features();
  const skeletonAnnotation = useWkSelector((state) => state.annotation.skeleton);
  const dispatch = useDispatch();
  const [doSplitMergerEvaluation, setDoSplitMergerEvaluation] = React.useState(false);

  return (
    <StartJobForm
      handleClose={() => dispatch(setAIJobModalStateAction("invisible"))}
      jobName={APIJobType.INFER_NEURONS}
      buttonLabel="Start AI neuron segmentation"
      title="AI Neuron Segmentation"
      suggestedDatasetSuffix="with_reconstructed_neurons"
      isBoundingBoxConfigurable
      jobCreditCostPerGVx={neuronInferralCostPerGVx}
      jobApiCall={async (
        { newDatasetName, selectedLayer: colorLayer, selectedBoundingBox, annotationId },
        form: FormInstance<any>,
      ) => {
        const splitMergerEvaluationSettings = form.getFieldValue(
          "splitMergerEvaluationSettings",
        ) as SplitMergerEvaluationSettings;
        if (
          !selectedBoundingBox ||
          (doSplitMergerEvaluation && splitMergerEvaluationSettings == null)
        ) {
          return;
        }

        const bbox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);
        const mag = getBestFittingMagComparedToTrainingDS(
          colorLayer,
          dataset.dataSource.scale,
          APIJobType.INFER_NEURONS,
        );
        if (isDatasetOrBoundingBoxTooSmall(bbox, mag, colorLayer, APIJobType.INFER_NEURONS)) {
          return;
        }

        if (!doSplitMergerEvaluation) {
          return startNeuronInferralJob(
            dataset.id,
            colorLayer.name,
            bbox,
            newDatasetName,
            doSplitMergerEvaluation,
          );
        }

        const state = Store.getState();
        const userBoundingBoxCount = getUserBoundingBoxesFromState(state).length;

        if (userBoundingBoxCount > 1) {
          Toast.error(messages["jobs.wrongNumberOfBoundingBoxes"]);
          return;
        }

        const taskBoundingBoxes = getTaskBoundingBoxes(state);
        if (Object.values(taskBoundingBoxes).length + userBoundingBoxCount !== 1) {
          Toast.error(messages["jobs.wrongNumberOfBoundingBoxes"]);
          return;
        }

        if (skeletonAnnotation == null || skeletonAnnotation.trees.size() === 0) {
          Toast.error(
            "Please ensure that a skeleton tree exists within the selected bounding box.",
          );
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
          doSplitMergerEvaluation,
          annotationId,
          splitMergerEvaluationSettings.useSparseTracing,
          splitMergerEvaluationSettings.maxEdgeLength,
          splitMergerEvaluationSettings.sparseTubeThresholdInNm,
          splitMergerEvaluationSettings.minimumMergerPathLengthInNm,
        );
      }}
      description={
        <>
          <Space direction="vertical" size="middle">
            <Row>
              This pre-trained AI model will automatically detect and segment all neurons in this
              dataset. It is optimized for analyzing EM tissue, e.g. from FIB-SEM, MSEM,
              Serial-Section SEM etc. Webknossos will create a copy of this dataset and add the
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
