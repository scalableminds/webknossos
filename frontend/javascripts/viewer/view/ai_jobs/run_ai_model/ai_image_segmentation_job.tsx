import { Flex } from "antd";
import { RunAiModelCreditInformation } from "../credit_information";
import { AiAnalysisParameters } from "./ai_analysis_parameters";
import { RunAiModelJobContextProvider } from "./ai_image_segmentation_job_context";
import { AiModelSelector } from "./ai_model_selector";

export const AiImageSegmentationJob = () => {
  return (
    <RunAiModelJobContextProvider>
      <Flex gap={24}>
        <Flex flex="2" vertical gap={24}>
          <AiModelSelector />
          <AiAnalysisParameters />
        </Flex>
        <Flex flex="1" vertical>
          <RunAiModelCreditInformation />
        </Flex>
      </Flex>
    </RunAiModelJobContextProvider>
  );
};
