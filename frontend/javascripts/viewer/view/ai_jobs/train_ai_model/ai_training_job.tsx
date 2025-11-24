import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Flex, Space, Typography } from "antd";
import { ColorWKBlue } from "theme";
import { TrainingCreditInformation } from "../credit_information";
import { AiTrainingDataSection } from "./ai_training_data_selector";
import { AiTrainingJobContextProvider } from "./ai_training_job_context";
import { AiTrainingModelSelector } from "./ai_training_model_selector";
import { AiTrainingSettings } from "./ai_training_settings";

export const AiModelTrainingJob = () => {
  return (
    <AiTrainingJobContextProvider>
      <Flex gap={24}>
        <Flex flex="2" vertical gap={24}>
          <Card
            type="inner"
            title={
              <Space align="center">
                <InfoCircleOutlined style={{ color: ColorWKBlue }} />
                Train AI Model
              </Space>
            }
          >
            <Typography.Text>
              Train a custom AI model on your own data to automate segmentation tasks. Select a
              model type, provide training data, and configure settings to start training.
            </Typography.Text>
          </Card>
          <AiTrainingModelSelector />
          <AiTrainingDataSection />
          <AiTrainingSettings />
        </Flex>
        <Flex flex="1" vertical>
          <TrainingCreditInformation />
        </Flex>
      </Flex>
    </AiTrainingJobContextProvider>
  );
};
