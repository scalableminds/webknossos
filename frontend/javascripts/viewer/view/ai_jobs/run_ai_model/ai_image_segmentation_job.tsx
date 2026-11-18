import features from "features";
import { AiJobLayout } from "../components/job_layout";
import { RunAiModelCreditInformation } from "../credit_information";
import { AiAnalysisSettings } from "./ai_analysis_settings";
import {
  RunAiModelJobContextProvider,
  useRunAiModelJobContext,
} from "./ai_image_segmentation_job_context";
import { AiModelSelector } from "./ai_model_selector";
import { ProofreadingNextStep } from "./proofreading_next_step";

function RunAiModelJobLayout() {
  const { startedJob } = useRunAiModelJobContext();
  return (
    <AiJobLayout
      description="Run pre-trained or custom AI models on your data to automatically segment structures. Select a model and configure analysis settings to start the inference job."
      sidebar={<RunAiModelCreditInformation />}
      startedJob={startedJob}
      nextStep={features().isWkorgInstance ? <ProofreadingNextStep /> : null}
    >
      <AiModelSelector />
      <AiAnalysisSettings />
    </AiJobLayout>
  );
}

export const AiImageSegmentationJob = () => {
  return (
    <RunAiModelJobContextProvider>
      <RunAiModelJobLayout />
    </RunAiModelJobContextProvider>
  );
};
