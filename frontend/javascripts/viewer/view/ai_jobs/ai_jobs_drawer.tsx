import { Drawer, Tabs } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import { AiImageAlignmentJob } from "./alignment/ai_image_alignment_job";
import type { StartAiJobDrawerState } from "./constants";
import { AiImageSegmentationJob } from "./run_ai_model/ai_image_segmentation_job";
import { AiModelTrainingJob } from "./train_ai_model/ai_training_job";

export const AiJobsDrawer = ({ isOpen }: { isOpen: boolean }) => {
  const dispatch = useDispatch();
  const isSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser);
  const ai_job_drawer_state = useWkSelector((state) => state.uiInformation.aIJobDrawerState);

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
    ...(isSuperUser
      ? [
          {
            label: "Train Segmentation Model",
            key: "open_ai_training",
            children: <AiModelTrainingJob />,
          },
        ]
      : []),
    {
      label: "Image Alignment",
      key: "open_ai_alignment",
      children: <AiImageAlignmentJob />,
    },
  ];

  const activeKey =
    !isSuperUser && ai_job_drawer_state === "open_ai_training"
      ? "open_ai_inference"
      : ai_job_drawer_state;

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
