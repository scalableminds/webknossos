import { AiJobLayout } from "../components/job_layout";
import { AlignmentCreditInformation } from "../credit_information";
import { AlignmentJobContextProvider } from "./ai_alignment_job_context";
import { AiAlignmentModelSelector } from "./ai_alignment_model_selector";
import { AiAlignmentSettings } from "./ai_alignment_settings";

export const AiImageAlignmentJob = () => {
  return (
    <AlignmentJobContextProvider>
      <AiJobLayout
        description="Align sections of your dataset to correct for shifts and rotations. Select an alignment task and configure settings to start the alignment process."
        sidebar={<AlignmentCreditInformation />}
      >
        <AiAlignmentModelSelector />
        <AiAlignmentSettings />
      </AiJobLayout>
    </AlignmentJobContextProvider>
  );
};
