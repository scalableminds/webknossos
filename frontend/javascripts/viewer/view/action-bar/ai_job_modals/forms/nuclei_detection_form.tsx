import { startNucleiInferralJob } from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox } from "libs/utils";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { APIJobType } from "types/api_types";
import { Unicode } from "viewer/constants";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import { getBestFittingMagComparedToTrainingDS, isDatasetOrBoundingBoxTooSmall } from "../utils";
import { type JobApiCallArgsType, StartJobForm } from "./start_job_form";

const { ThinSpace } = Unicode;

export function NucleiDetectionForm() {
  const dataset = useWkSelector((state) => state.dataset);
  const dispatch = useDispatch();

  const handleClose = useCallback(
    () => dispatch(setAIJobModalStateAction("invisible")),
    [dispatch],
  );
  const jobApiCall = useCallback(
    async ({
      newDatasetName,
      selectedLayer: colorLayer,
      selectedBoundingBox,
    }: JobApiCallArgsType) => {
      if (!selectedBoundingBox) {
        return;
      }
      const bbox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);
      const mag = getBestFittingMagComparedToTrainingDS(
        colorLayer,
        dataset.dataSource.scale,
        APIJobType.INFER_NUCLEI,
      );
      if (isDatasetOrBoundingBoxTooSmall(bbox, mag, colorLayer, APIJobType.INFER_NUCLEI)) {
        return;
      }
      startNucleiInferralJob(dataset.id, colorLayer.name, newDatasetName);
    },
    [dataset],
  );

  return (
    <StartJobForm
      handleClose={handleClose}
      buttonLabel="Start AI nuclei detection"
      jobName={APIJobType.INFER_NUCLEI}
      title="AI Nuclei Segmentation"
      suggestedDatasetSuffix="with_nuclei"
      jobApiCall={jobApiCall}
      description={
        <>
          <p>
            Start an AI background job to automatically detect and segment all nuclei in this
            dataset. This AI will create a copy of this dataset containing all the detected nuclei
            as a new segmentation layer.
          </p>
          <p>
            <b>
              Note that this feature is still experimental. Nuclei detection currently only works
              with EM data and a magnification of approximately 200{ThinSpace}nm per voxel. The
              segmentation process will automatically use the magnification that matches that
              magnification best.
            </b>
          </p>
        </>
      }
    />
  );
}
