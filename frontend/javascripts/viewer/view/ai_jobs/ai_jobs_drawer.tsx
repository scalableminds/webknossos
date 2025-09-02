import { Drawer, Tabs } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import { AiImageAlignmentJob } from "./alignment/ai_image_alignment_job";
import { AiImageSegmentationJob } from "./run_ai_model/ai_image_segmentation_job";
import { AiModelTrainingJob } from "./train_ai_model/ai_training_job";

export const AiJobsDrawer = ({ isOpen }: { isOpen: boolean }) => {
  const dispatch = useDispatch();
  const ai_job_drawer_state = useWkSelector((state) => state.uiInformation.aIJobDrawerState);

  const handleClose = useCallback(() => {
    dispatch(setAIJobDrawerStateAction("invisible"));
  }, [dispatch]);

  const items = [
    {
      label: "Image Segmentation",
      key: "open_ai_inference",
      children: <AiImageSegmentationJob />,
    },
    {
      label: "Model Training",
      key: "open_ai_training",
      children: <AiModelTrainingJob />,
    },
    {
      label: "Image Alignment",
      key: "open_ai_alignment",
      children: <AiImageAlignmentJob />,
    },
  ];

  return (
    <Drawer title="AI Jobs" placement="right" width={1200} open={isOpen} onClose={handleClose}>
      <Tabs defaultActiveKey={ai_job_drawer_state} items={items} />
    </Drawer>
  );
};
