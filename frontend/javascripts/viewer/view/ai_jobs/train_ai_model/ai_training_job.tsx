import { AiJobLayout } from "../components/job_layout";
import { TrainingCreditInformation } from "../credit_information";
import { AiTrainingDataSection } from "./ai_training_data_selector";
import { AiTrainingJobContextProvider, useAiTrainingJobContext } from "./ai_training_job_context";
import { AiTrainingModelSelector } from "./ai_training_model_selector";
import { AiTrainingSettings } from "./ai_training_settings";

function TrainingJobLayout() {
  const { startedJob } = useAiTrainingJobContext();
  return (
    <AiJobLayout
      description="Train a custom AI model on your own data to automate segmentation tasks. Select a model type, provide training data, and configure settings to start training."
      sidebar={<TrainingCreditInformation />}
      startedJob={startedJob}
    >
      <AiTrainingModelSelector />
      <AiTrainingDataSection />
      <AiTrainingSettings />
    </AiJobLayout>
  );
}

export const AiModelTrainingJob = () => {
  return (
    <AiTrainingJobContextProvider>
      <TrainingJobLayout />
    </AiTrainingJobContextProvider>
  );
};
