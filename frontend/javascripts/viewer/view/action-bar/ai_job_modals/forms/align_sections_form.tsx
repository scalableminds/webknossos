import { startAlignSectionsJob } from "admin/rest_api";
import { Alert, Row, Space } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { APIJobType } from "types/api_types";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import { type JobApiCallArgsType, StartJobForm } from "./start_job_form";

export function AlignSectionsForm() {
  const dataset = useWkSelector((state) => state.dataset);
  const dispatch = useDispatch();
  const { alignmentCostPerGVx } = features();

  const handleClose = useCallback(
    () => dispatch(setAIJobModalStateAction("invisible")),
    [dispatch],
  );
  const jobApiCall = useCallback(
    async ({ newDatasetName, selectedLayer: colorLayer, annotationId }: JobApiCallArgsType) =>
      startAlignSectionsJob(dataset.id, colorLayer.name, newDatasetName, annotationId),
    [dataset.id],
  );

  return (
    <StartJobForm
      handleClose={handleClose}
      jobName={APIJobType.ALIGN_SECTIONS}
      buttonLabel="Start section alignment job"
      title="Section Alignment"
      suggestedDatasetSuffix="aligned"
      isBoundingBoxConfigurable={false}
      isSkeletonSelectable={true}
      jobApiCall={jobApiCall}
      jobCreditCostPerGVx={alignmentCostPerGVx}
      description={
        <Space orientation="vertical" size="middle">
          <Row>
            This job will automatically align all the sections of the dataset. If you want to align
            a dataset with multiple tiles per section, please contact us.
          </Row>
          <Row style={{ display: "grid", marginBottom: 16 }}>
            <Alert
              title="Please note that this feature is still experimental. Contact us if you have any problems or need alignment errors to be fixed."
              type="warning"
              showIcon
            />
          </Row>
        </Space>
      }
    />
  );
}
