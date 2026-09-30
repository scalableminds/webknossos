import { CreditCardOutlined, InfoCircleOutlined, SettingOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Collapse,
  Divider,
  Flex,
  Form,
  Input,
  Modal,
  Row,
  Space,
  Typography,
} from "antd";
import { KeyValuePairsFormItem } from "components/key_value_pairs";
import { formatBytes, formatMilliCreditsString } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useEffect, useState } from "react";
import { ColorWKBlue, ColorWKGold, ModalWidth } from "theme";
import {
  AlignmentProjectTaskType,
  type APIAlignmentProject,
  getAlignmentProjectTaskTypeName,
  getMockAlignmentCostInMilliCredits,
  startAlignmentProjectJob,
} from "./alignment_project_mock_data";

const { Text, Title } = Typography;

type FormValues = {
  newDatasetName: string;
  customConfiguration: Record<string, unknown>;
};

export function StartAlignmentProjectModal({
  project,
  isOpen,
  onClose,
  onStarted,
}: {
  project: APIAlignmentProject;
  isOpen: boolean;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const selectedTaskType = project.detectedTaskType;
  const [isStarting, setIsStarting] = useState(false);
  const organizationMilliCredits = useWkSelector(
    (state) => state.activeOrganization?.milliCreditBalance || 0,
  );

  useEffect(() => {
    const suffix =
      selectedTaskType === AlignmentProjectTaskType.ALIGN_SECTIONS ? "aligned" : "stitched";
    form.setFieldValue(
      "newDatasetName",
      `${project.name.replace(/[^\w-]+/g, "_").toLowerCase()}_${suffix}_v${project.runs.length + 1}`,
    );
  }, [form, project, selectedTaskType]);

  const costInMilliCredits = getMockAlignmentCostInMilliCredits(project, selectedTaskType);
  const hasEnoughCredits = costInMilliCredits <= organizationMilliCredits;

  const handleStart = async () => {
    const values = await form.validateFields();
    setIsStarting(true);
    try {
      await startAlignmentProjectJob(
        project.id,
        selectedTaskType,
        values.newDatasetName,
        values.customConfiguration ?? {},
      );
      Toast.success("Alignment started successfully!");
      onStarted();
      onClose();
    } catch (error) {
      console.error(error);
      Toast.error("Failed to start alignment.");
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Modal
      title={`Start Alignment for ${project.name}`}
      open={isOpen}
      onCancel={onClose}
      width={ModalWidth.ExtraLarge}
      footer={null}
      destroyOnHidden
    >
      <Flex gap={24}>
        <Flex flex="2" vertical gap={24}>
          <Card
            type="inner"
            title={
              <Space align="center">
                <InfoCircleOutlined style={{ color: ColorWKBlue }} />
                Input Data
              </Space>
            }
          >
            <Space vertical>
              <Text>
                {project.fileCount.toLocaleString()} files (
                {formatBytes(project.totalSizeInBytes, 1)}), with tile positions listed in{" "}
                <Text code>{project.csvFileName}</Text>. The result will be written to a new
                dataset.
              </Text>
              <Text>
                Detected alignment task:{" "}
                <Text strong>{getAlignmentProjectTaskTypeName(selectedTaskType)}</Text>
              </Text>
            </Space>
          </Card>
          <Card
            type="inner"
            title={
              <Space align="center">
                <SettingOutlined style={{ color: ColorWKBlue }} />
                Alignment Settings
              </Space>
            }
          >
            <Form form={form} layout="vertical">
              <Form.Item
                name="newDatasetName"
                label="New Dataset Name"
                rules={[{ required: true, message: "Please provide a name for the new dataset" }]}
              >
                <Input />
              </Form.Item>
              <Collapse
                ghost
                items={[
                  {
                    key: "advanced",
                    label: "Advanced Settings",
                    children: (
                      <KeyValuePairsFormItem
                        name="customConfiguration"
                        label="Custom Configuration"
                      />
                    ),
                  },
                ]}
              />
            </Form>
          </Card>
        </Flex>
        <Flex flex="1" vertical>
          <Card
            type="inner"
            title={
              <Space align="center">
                <CreditCardOutlined style={{ color: ColorWKGold }} />
                Credit Information
              </Space>
            }
          >
            <Row justify="space-between">
              <Col>
                <Text>Available Credits</Text>
              </Col>
              <Col>
                <Text strong>{formatMilliCreditsString(organizationMilliCredits)}</Text>
              </Col>
            </Row>
            <Divider />
            <Title level={5}>Cost Breakdown:</Title>
            <Row justify="space-between">
              <Col>
                <Text>Task:</Text>
              </Col>
              <Col>
                <Text strong>{getAlignmentProjectTaskTypeName(selectedTaskType)}</Text>
              </Col>
            </Row>
            <Row justify="space-between">
              <Col>
                <Text>Input Size:</Text>
              </Col>
              <Col>
                <Text strong>{formatBytes(project.totalSizeInBytes, 1)}</Text>
              </Col>
            </Row>
            <Divider />
            <Row justify="space-between" align="middle">
              <Col>
                <Text>Total Cost:</Text>
              </Col>
              <Col>
                <Title level={3} style={{ margin: 0 }}>
                  {formatMilliCreditsString(costInMilliCredits)} credits
                </Title>
              </Col>
            </Row>
            <Button
              type="primary"
              block
              size="large"
              style={{ marginTop: 24 }}
              disabled={!hasEnoughCredits}
              loading={isStarting}
              onClick={handleStart}
            >
              Start alignment{hasEnoughCredits ? "" : " (not enough credits)"}
            </Button>
          </Card>
        </Flex>
      </Flex>
    </Modal>
  );
}
