import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Flex, Space, Typography } from "antd";
import { ColorWKBlue } from "theme";
import { RunAiModelCreditInformation } from "../credit_information";
import { AiAnalysisSettings } from "./ai_analysis_settings";
import { RunAiModelJobContextProvider } from "./ai_image_segmentation_job_context";
import { AiModelSelector } from "./ai_model_selector";

export const AiImageSegmentationJob = () => {
  return (
    <RunAiModelJobContextProvider>
      <Flex gap={24}>
        <Flex flex="2" vertical gap={24}>
          <Card
            type="inner"
            title={
              <Space align="center">
                <InfoCircleOutlined style={{ color: ColorWKBlue }} />
                Run AI Model
              </Space>
            }
          >
            <Typography.Text>
              Run pre-trained or custom AI models on your data to automatically segment structures.
              Select a model and configure analysis settings to start the inference job.
            </Typography.Text>
          </Card>
          <AiModelSelector />
          <AiAnalysisSettings />
        </Flex>
        <Flex flex="1" vertical>
          <RunAiModelCreditInformation />
        </Flex>
      </Flex>
    </RunAiModelJobContextProvider>
  );
};
