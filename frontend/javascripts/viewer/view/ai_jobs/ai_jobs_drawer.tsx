import { hasAiPlan } from "admin/organization/pricing_plan_utils";
import { Drawer, Tabs, theme } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useCallback, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import type { APIJobCommand } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import GenerateBoundingBoxesModal from "viewer/view/right_border_tabs/generate_bounding_boxes_modal";
import { AiImageAlignmentJob } from "./alignment/ai_image_alignment_job";
import { AiTrainingUnavailableNotice } from "./components/ai_training_unavailable_notice";
import type { StartAiJobDrawerState } from "./constants";
import { GenerateBBModalContext, type GenerateBBModalState } from "./generate_BB_modal_context";
import { AiImageSegmentationJob } from "./run_ai_model/ai_image_segmentation_job";
import { AiModelTrainingJob } from "./train_ai_model/ai_training_job";

export const AiJobsDrawer = ({ isOpen }: { isOpen: boolean }) => {
  const dispatch = useDispatch();
  const orgaHasAiPlan = useWkSelector((state) => hasAiPlan(state.activeOrganization));
  const activeUser = useWkSelector((state) => state.activeUser);
  const isSuperUser = activeUser?.isSuperUser ?? false;
  const { token } = theme.useToken();

  const ai_job_drawer_state = useWkSelector((state) => state.uiInformation.aIJobDrawerState);
  const canTrainModels = isSuperUser || orgaHasAiPlan;

  const [generateBBModalState, setGenerateBBModalState] = useState<GenerateBBModalState>({
    isOpen: false,
    magnification: null,
    jobType: null,
  });

  const openGenerateBBModal = useCallback(
    (magnification: Vector3 | null, jobType: APIJobCommand | null) => {
      dispatch(setAIJobDrawerStateAction("invisible"));
      setGenerateBBModalState({ isOpen: true, magnification, jobType });
    },
    [dispatch],
  );

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

  const activeKey = ai_job_drawer_state === "invisible" ? "open_ai_inference" : ai_job_drawer_state;

  const generateBBModalContextValue = useMemo(
    () => ({ openGenerateBBModal }),
    [openGenerateBBModal],
  );

  return (
    <GenerateBBModalContext.Provider value={generateBBModalContextValue}>
      <Drawer
        title="Run a WEBKNOSSOS AI Job"
        placement="right"
        size={1200}
        open={isOpen}
        onClose={handleClose}
        destroyOnHidden
        styles={{
          body: {
            background: token.colorBgLayout,
            padding: 24,
          },
        }}
      >
        <Tabs activeKey={activeKey} items={items} onChange={handleChange} />
      </Drawer>
      {generateBBModalState.isOpen && (
        <GenerateBoundingBoxesModal
          isOpen={generateBBModalState.isOpen}
          onClose={() => setGenerateBBModalState((prev) => ({ ...prev, isOpen: false }))}
          magnification={generateBBModalState.magnification}
          jobType={generateBBModalState.jobType}
        />
      )}
    </GenerateBBModalContext.Provider>
  );
};
