import { AiJobLayout } from "../components/job_layout";
import { RunAiModelCreditInformation } from "../credit_information";
import { AiAnalysisSettings } from "./ai_analysis_settings";
import { RunAiModelJobContextProvider } from "./ai_image_segmentation_job_context";
import { AiModelSelector } from "./ai_model_selector";

export const AiImageSegmentationJob = () => {
  return (
    <RunAiModelJobContextProvider>
      <AiJobLayout
        description="Run pre-trained or custom AI models on your data to automatically segment structures. Select a model and configure analysis settings to start the inference job."
        sidebar={<RunAiModelCreditInformation />}
      >
        <AiModelSelector />
        <AiAnalysisSettings />
      </AiJobLayout>
    </RunAiModelJobContextProvider>
  );
};
