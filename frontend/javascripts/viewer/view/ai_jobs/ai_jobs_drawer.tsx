import {
  hasAiPlan,
  isAiAddonEligiblePlan,
  isUserAllowedToRequestUpgrades,
} from "admin/organization/pricing_plan_utils";
import UpgradePricingPlanModal from "admin/organization/upgrade_plan_modal";
import { Drawer, Tabs } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import { AiImageAlignmentJob } from "./alignment/ai_image_alignment_job";
import { AiTrainingUnavailableNotice } from "./components/ai_training_unavailable_notice";
import type { StartAiJobDrawerState } from "./constants";
import { AiImageSegmentationJob } from "./run_ai_model/ai_image_segmentation_job";
import { AiModelTrainingJob } from "./train_ai_model/ai_training_job";

export const AiJobsDrawer = ({ isOpen }: { isOpen: boolean }) => {
  const dispatch = useDispatch();
  const orgaHasAiPlan = useWkSelector((state) => hasAiPlan(state.activeOrganization));
  const activeUser = useWkSelector((state) => state.activeUser);
  const activeOrganization = useWkSelector((state) => state.activeOrganization);
  const isSuperUser = activeUser?.isSuperUser ?? false;
  const canRequestAiPlan = activeUser ? isUserAllowedToRequestUpgrades(activeUser) : false;
  const isEligibleForAiAddon = activeOrganization
    ? isAiAddonEligiblePlan(activeOrganization.pricingPlan)
    : false;
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
      children: canTrainModels ? (
        <AiModelTrainingJob />
      ) : (
        <AiTrainingUnavailableNotice
          onRequestUpgrade={
            canRequestAiPlan && activeOrganization
              ? () =>
                  UpgradePricingPlanModal.requestAiPlanUpgrade(activeOrganization)
              : undefined
          }
          canRequestAiAddon={canRequestAiPlan}
          isEligibleForAiAddon={isEligibleForAiAddon}
        />
      ),
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
