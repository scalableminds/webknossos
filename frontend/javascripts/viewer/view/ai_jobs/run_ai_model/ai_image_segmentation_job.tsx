import { ProofreadingAd } from "admin/ads/ai_job_ads";
import features from "features";
import { AiJobLayout } from "../components/job_layout";
import { JobStartedCard } from "../components/job_started_card";
import { RunAiModelCreditInformation } from "../credit_information";
import { AiAnalysisSettings } from "./ai_analysis_settings";
import {
  RunAiModelJobContextProvider,
  useRunAiModelJobContext,
} from "./ai_image_segmentation_job_context";
import { AiModelSelector } from "./ai_model_selector";

function RunAiModelSidebar() {
  const { startedJob, resetStartedJob } = useRunAiModelJobContext();
  if (startedJob == null) {
    return <RunAiModelCreditInformation />;
  }
  return (
    <JobStartedCard
      {...startedJob}
      onStartAnother={resetStartedJob}
      nextStep={features().isWkorgInstance ? <ProofreadingAd /> : null}
    />
  );
}

export const AiImageSegmentationJob = () => {
  return (
    <RunAiModelJobContextProvider>
      <AiJobLayout
        description="Run pre-trained or custom AI models on your data to automatically segment structures. Select a model and configure analysis settings to start the inference job."
        sidebar={<RunAiModelSidebar />}
      >
        <AiModelSelector />
        <AiAnalysisSettings />
      </AiJobLayout>
    </RunAiModelJobContextProvider>
  );
};
