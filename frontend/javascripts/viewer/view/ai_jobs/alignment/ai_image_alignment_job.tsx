import { AiJobLayout } from "../components/job_layout";
import { JobStartedCard } from "../components/job_started_card";
import { AlignmentCreditInformation } from "../credit_information";
import { AlignmentJobContextProvider, useAlignmentJobContext } from "./ai_alignment_job_context";
import { AiAlignmentModelSelector } from "./ai_alignment_model_selector";
import { AiAlignmentSettings } from "./ai_alignment_settings";

function AlignmentSidebar() {
  const { startedJob } = useAlignmentJobContext();
  if (startedJob == null) {
    return <AlignmentCreditInformation />;
  }
  return <JobStartedCard {...startedJob} />;
}

export const AiImageAlignmentJob = () => {
  return (
    <AlignmentJobContextProvider>
      <AiJobLayout
        description="Align sections of your dataset to correct for shifts and rotations. Select an alignment task and configure settings to start the alignment process."
        sidebar={<AlignmentSidebar />}
      >
        <AiAlignmentModelSelector />
        <AiAlignmentSettings />
      </AiJobLayout>
    </AlignmentJobContextProvider>
  );
};
