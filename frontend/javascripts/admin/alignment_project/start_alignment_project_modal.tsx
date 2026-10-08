import { CreditCardOutlined, InfoCircleOutlined, SettingOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  Divider,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
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
  getMockCostPerSectionInMilliCredits,
  getSectionCount,
  startAlignmentProjectJob,
} from "./alignment_project_mock_data";

const { Text, Title } = Typography;

type FormValues = {
  newDatasetName: string;
  shouldRenderUnalignedPreview: boolean;
  sectionRangeMode: "all" | "subset";
  firstSection: number;
  lastSection: number;
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
  const sectionRangeMode = Form.useWatch("sectionRangeMode", form);
  const firstSection = Form.useWatch("firstSection", form);
  const lastSection = Form.useWatch("lastSection", form);
  const { first: minSection, last: maxSection } = project.sectionRange;
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

  const selectedSectionRange: [number, number] | null =
    sectionRangeMode !== "subset"
      ? [minSection, maxSection]
      : firstSection != null && lastSection != null && firstSection <= lastSection
        ? [firstSection, lastSection]
        : null;
  const costInMilliCredits =
    selectedSectionRange != null
      ? getMockAlignmentCostInMilliCredits(project, selectedTaskType, selectedSectionRange)
      : null;
  const hasEnoughCredits =
    costInMilliCredits != null && costInMilliCredits <= organizationMilliCredits;

  const handleStart = async () => {
    const values = await form.validateFields();
    setIsStarting(true);
    try {
      await startAlignmentProjectJob(project.id, selectedTaskType, {
        newDatasetName: values.newDatasetName,
        shouldRenderUnalignedPreview: values.shouldRenderUnalignedPreview,
        sectionRange:
          values.sectionRangeMode === "subset" ? [values.firstSection, values.lastSection] : null,
        customConfiguration: values.customConfiguration ?? {},
      });
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
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            shouldRenderUnalignedPreview: false,
            sectionRangeMode: "all",
            firstSection: minSection,
            lastSection: maxSection,
          }}
          style={{ flex: 2 }}
        >
          <Flex vertical gap={24}>
            <Card
              type="inner"
              title={
                <Space align="center">
                  <InfoCircleOutlined style={{ color: ColorWKBlue }} />
                  Input Data
                </Space>
              }
            >
              <Typography.Paragraph>
                {project.fileCount.toLocaleString()} files (
                {formatBytes(project.totalSizeInBytes, 1)}
                ), with tile positions listed in <Text code>{project.csvFileName}</Text>. The result
                will be written to a new dataset.
              </Typography.Paragraph>
              <Form.Item name="sectionRangeMode" label="Sections">
                <Radio.Group
                  options={[
                    {
                      value: "all",
                      label: `All sections (${minSection}–${maxSection})`,
                    },
                    { value: "subset", label: "Subset of sections" },
                  ]}
                />
              </Form.Item>
              {sectionRangeMode === "subset" && (
                <Space align="start">
                  <Form.Item
                    name="firstSection"
                    label="First Section"
                    rules={[{ required: true, message: "Please enter the first section." }]}
                  >
                    <InputNumber min={minSection} max={maxSection} precision={0} />
                  </Form.Item>
                  <Form.Item
                    name="lastSection"
                    label="Last Section"
                    dependencies={["firstSection"]}
                    rules={[
                      { required: true, message: "Please enter the last section." },
                      ({ getFieldValue }) => ({
                        validator: (_rule, value) =>
                          value == null || value >= getFieldValue("firstSection")
                            ? Promise.resolve()
                            : Promise.reject(
                                new Error("Must not be smaller than the first section."),
                              ),
                      }),
                    ]}
                  >
                    <InputNumber min={minSection} max={maxSection} precision={0} />
                  </Form.Item>
                </Space>
              )}
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
              <Form.Item
                name="newDatasetName"
                label="Output Dataset Name"
                rules={[{ required: true, message: "Please provide a name for the new dataset" }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="shouldRenderUnalignedPreview"
                valuePropName="checked"
                tooltip="Renders the input data without alignment, so that you can preview it while the alignment is still running."
                label="Preview"
              >
                <Checkbox>Render unaligned data as a preview</Checkbox>
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
            </Card>
          </Flex>
        </Form>
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
                <Text>Sections:</Text>
              </Col>
              <Col>
                <Text strong>
                  {selectedSectionRange != null
                    ? getSectionCount({
                        first: selectedSectionRange[0],
                        last: selectedSectionRange[1],
                      }).toLocaleString()
                    : "-"}
                </Text>
              </Col>
            </Row>
            <Row justify="space-between">
              <Col>
                <Text>Credits per Section:</Text>
              </Col>
              <Col>
                <Text strong>
                  {formatMilliCreditsString(
                    getMockCostPerSectionInMilliCredits(project, selectedTaskType),
                  )}
                </Text>
              </Col>
            </Row>
            <Divider />
            <Row justify="space-between" align="middle">
              <Col>
                <Text>Total Cost:</Text>
              </Col>
              <Col>
                <Title level={3} style={{ margin: 0 }}>
                  {costInMilliCredits != null
                    ? `${formatMilliCreditsString(costInMilliCredits)} credits`
                    : "-"}
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
              Start alignment
              {costInMilliCredits != null && !hasEnoughCredits ? " (not enough credits)" : ""}
            </Button>
          </Card>
        </Flex>
      </Flex>
    </Modal>
  );
}
