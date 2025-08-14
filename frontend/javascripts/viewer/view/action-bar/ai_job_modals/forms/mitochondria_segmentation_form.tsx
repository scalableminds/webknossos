import { startMitochondriaInferralJob } from "admin/rest_api";
import { Row, Space } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox } from "libs/utils";
import { useDispatch } from "react-redux";
import { APIJobType } from "types/api_types";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import { ExperimentalInferenceAlert } from "../components/experimental_inference_alert";
import { getBestFittingMagComparedToTrainingDS, isDatasetOrBoundingBoxTooSmall } from "../utils";
import { StartJobForm } from "./start_job_form";

export function MitochondriaSegmentationForm() {
  const dataset = useWkSelector((state) => state.dataset);
  const { mitochondriaInferralCostPerGVx } = features();
  const dispatch = useDispatch();
  return (
    <StartJobForm
      handleClose={() => dispatch(setAIJobModalStateAction("invisible"))}
      jobName={APIJobType.INFER_MITOCHONDRIA}
      buttonLabel="Start AI mitochondria segmentation"
      title="AI Mitochondria Segmentation"
      suggestedDatasetSuffix="with_mitochondria_detected"
      isBoundingBoxConfigurable
      jobCreditCostPerGVx={mitochondriaInferralCostPerGVx}
      jobApiCall={async ({ newDatasetName, selectedLayer: colorLayer, selectedBoundingBox }) => {
        if (!selectedBoundingBox) {
          return;
        }
        const bbox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);
        const mag = getBestFittingMagComparedToTrainingDS(
          colorLayer,
          dataset.dataSource.scale,
          APIJobType.INFER_MITOCHONDRIA,
        );
        if (isDatasetOrBoundingBoxTooSmall(bbox, mag, colorLayer, APIJobType.INFER_MITOCHONDRIA)) {
          return;
        }
        return startMitochondriaInferralJob(dataset.id, colorLayer.name, bbox, newDatasetName);
      }}
      description={
        <>
          <Space direction="vertical" size="middle">
            <Row>
              This pre-trained AI model will automatically detect and segment all mitochondria in
              this dataset. It is optimized for analyzing EM tissue, e.g. from FIB-SEM, MSEM,
              Serial-Section SEM etc. Webknossos will create a copy of this dataset and add the
              resulting mitochondria segmentation to it.
            </Row>
            <Row style={{ display: "grid", marginBottom: 16 }}>
              <ExperimentalInferenceAlert />
            </Row>
          </Space>
        </>
      }
    />
  );
}
