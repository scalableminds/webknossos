import { Flex } from "antd";
import { TrainingCreditInformation } from "../credit_information";
import { AiTrainingDataSection } from "./ai_training_data_selector";
import { AiTrainingJobContextProvider } from "./ai_training_job_context";
import { AiTrainingModelSelector } from "./ai_training_model_selector";
import { AiTrainingParameters } from "./ai_training_parameters";

export const AiModelTrainingJob = () => {
  return (
    <AiTrainingJobContextProvider>
      <Flex gap={24}>
        <Flex flex="2" vertical gap={24}>
          <AiTrainingModelSelector />
          <AiTrainingDataSection />
          <AiTrainingParameters />
        </Flex>
        <Flex flex="1" vertical>
          <TrainingCreditInformation />
        </Flex>
      </Flex>
    </AiTrainingJobContextProvider>
  );
};
