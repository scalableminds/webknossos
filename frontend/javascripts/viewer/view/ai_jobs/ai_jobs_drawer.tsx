import { hasAiPlan } from "admin/organization/pricing_plan_utils";
import { Alert, Drawer, Tabs, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import { AiImageAlignmentJob } from "./alignment/ai_image_alignment_job";
import type { StartAiJobDrawerState } from "./constants";
import { AiImageSegmentationJob } from "./run_ai_model/ai_image_segmentation_job";
import { AiModelTrainingJob } from "./train_ai_model/ai_training_job";

const AiTrainingUnavailableNotice = () => (
  <Alert
    showIcon
    type="info"
    message="AI training requires the AI add-on"
    description={
      <Typography.Text>
        To train models, your organization needs the AI add-on. Ask your organization admin to
        book it.
      </Typography.Text>
    }
  />
);

export const AiJobsDrawer = ({ isOpen }: { isOpen: boolean }) => {
  const dispatch = useDispatch();
  const orgaHasAiPlan = useWkSelector((state) => hasAiPlan(state.activeOrganization));
  const isSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser) ?? false;
  const ai_job_drawer_state = useWkSelector((state) => state.uiInformation.aIJobDrawerState);
  const canTrainModels = isSuperUser || orgaHasAiPlan;

  const handleChange = useCallback(
    (key: string) => {
      dispatch(setAIJobDrawerStateAction(key as StartAiJobDrawerState));
    },
    [dispatch],
  );

  const handleClose = useCallback(() => {
    dispatch(setAIJobDrawerStateAction("invisible"));
  }, [dispatch]);

  const items = [
    {
      label: "Run Segmentation Model",
      key: "open_ai_inference",
      children: <AiImageSegmentationJob />,
    },
    {
      label: "Train Segmentation Model",
      key: "open_ai_training",
      children: canTrainModels ? <AiModelTrainingJob /> : <AiTrainingUnavailableNotice />,
    },
    {
      label: "Image Alignment",
      key: "open_ai_alignment",
      children: <AiImageAlignmentJob />,
    },
  ];

  const activeKey =
    ai_job_drawer_state === "invisible" ? "open_ai_inference" : ai_job_drawer_state;

  return (
    <Drawer
      title="Run a WEBKNOSSOS AI Job"
      placement="right"
      size={1200}
      open={isOpen}
      onClose={handleClose}
      destroyOnHidden
    >
      <Tabs activeKey={activeKey} items={items} onChange={handleChange} />
    </Drawer>
  );
};
