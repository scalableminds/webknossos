import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Flex, Space, Typography } from "antd";
import { ColorWKBlue } from "theme";
import { AlignmentCreditInformation } from "../credit_information";
import { AlignmentJobContextProvider } from "./ai_alignment_job_context";
import { AiAlignmentModelSelector } from "./ai_alignment_model_selector";
import { AiAlignmentSettings } from "./ai_alignment_settings";

export const AiImageAlignmentJob = () => {
  return (
    <AlignmentJobContextProvider>
      <Flex gap={24}>
        <Flex flex="2" vertical gap={24}>
          <Card
            type="inner"
            title={
              <Space align="center">
                <InfoCircleOutlined style={{ color: ColorWKBlue }} />
                Align Sections
              </Space>
            }
          >
            <Typography.Text>
              Align sections of your dataset to correct for shifts and rotations. Select an
              alignment task and configure settings to start the alignment process.
            </Typography.Text>
          </Card>
          <AiAlignmentModelSelector />
          <AiAlignmentSettings />
        </Flex>
        <Flex flex="1" vertical>
          <AlignmentCreditInformation />
        </Flex>
      </Flex>
    </AlignmentJobContextProvider>
  );
};
