import { Flex } from "antd";
import { AlignmentCreditInformation } from "../credit_information";
import { AlignmentJobContextProvider } from "./ai_alignment_job_context";
import { AiAlignmentModelSelector } from "./ai_alignment_model_selector";
import { AiAlignmentParameters } from "./ai_alignment_parameters";

export const AiImageAlignmentJob = () => {
  return (
    <AlignmentJobContextProvider>
      <Flex gap={24}>
        <Flex flex="2" vertical gap={24}>
          <AiAlignmentModelSelector />
          <AiAlignmentParameters />
        </Flex>
        <Flex flex="1" vertical>
          <AlignmentCreditInformation />
        </Flex>
      </Flex>
    </AlignmentJobContextProvider>
  );
};
