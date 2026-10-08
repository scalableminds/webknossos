import { CreditCardOutlined, InfoCircleOutlined, SettingOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  type APIAlignmentProject,
  getAlignmentProjectJobCreditCost,
  type SectionRange,
  startAlignmentProjectJob,
} from "admin/api/alignment_projects";
import {
  Button,
  Card,
  Col,
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
import { useFolderHierarchyQuery } from "dashboard/dataset/queries";
import FolderSelection from "dashboard/folders/folder_selection";
import { formatBytes, formatMilliCreditsString } from "libs/format_utils";
import Toast from "libs/toast";
import { useEffect, useState } from "react";
import { ColorWKBlue, ColorWKGold, ModalWidth } from "theme";
import { getAlignmentRunTypeName, getSectionCount } from "./alignment_project_utils";

const { Text, Title } = Typography;

type FormValues = {
  mode: "align" | "renderUnaligned";
  newDatasetName: string;
  folderId: string | null;
  sectionRangeMode: "all" | "subset";
  firstSection: number;
  lastSection: number;
};

export function StartAlignmentProjectModal({
  project,
  sectionRange,
  isOpen,
  onClose,
  onStarted,
}: {
  project: APIAlignmentProject;
  // Passed separately because only projects with a known section range can be aligned.
  sectionRange: SectionRange;
  isOpen: boolean;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const mode = Form.useWatch("mode", form);
  const sectionRangeMode = Form.useWatch("sectionRangeMode", form);
  const firstSection = Form.useWatch("firstSection", form);
  const lastSection = Form.useWatch("lastSection", form);
  const renderUnaligned = mode === "renderUnaligned";
  const { first: minSection, last: maxSection } = sectionRange;
  const [isStarting, setIsStarting] = useState(false);
  const { data: folderHierarchy } = useFolderHierarchyQuery();
  const rootFolderId = folderHierarchy?.tree[0]?.key ?? null;

  useEffect(() => {
    const suffix = renderUnaligned ? "unaligned" : "aligned";
    form.setFieldValue(
      "newDatasetName",
      `${project.name.replace(/[^\w-]+/g, "_").toLowerCase()}_${suffix}_v${project.jobCount + 1}`,
    );
  }, [form, project, renderUnaligned]);

  useEffect(() => {
    if (rootFolderId != null && form.getFieldValue("folderId") == null) {
      form.setFieldValue("folderId", rootFolderId);
    }
  }, [form, rootFolderId]);

  const selectedSectionRange: SectionRange | null =
    sectionRangeMode !== "subset"
      ? sectionRange
      : firstSection != null && lastSection != null && firstSection <= lastSection
        ? { first: firstSection, last: lastSection }
        : null;
  const { data: creditCostInfo, isFetching: isFetchingCost } = useQuery({
    queryKey: [
      "alignmentProjectJobCreditCost",
      project.id,
      renderUnaligned,
      selectedSectionRange?.first,
      selectedSectionRange?.last,
    ],
    queryFn: () =>
      getAlignmentProjectJobCreditCost(project.id, renderUnaligned, selectedSectionRange),
    enabled: isOpen && selectedSectionRange != null,
  });
  const costInMilliCredits =
    selectedSectionRange != null ? creditCostInfo?.costInMilliCredits : null;
  const hasEnoughCredits = costInMilliCredits != null && creditCostInfo?.hasEnoughCredits === true;
  const costPerSectionInMilliCredits =
    costInMilliCredits != null && selectedSectionRange != null
      ? costInMilliCredits / getSectionCount(selectedSectionRange)
      : null;

  const handleStart = async () => {
    const values = await form.validateFields();
    setIsStarting(true);
    try {
      await startAlignmentProjectJob(project.id, {
        newDatasetName: values.newDatasetName,
        folderId: values.folderId ?? rootFolderId,
        renderUnaligned: values.mode === "renderUnaligned",
        sectionRange:
          values.sectionRangeMode === "subset"
            ? { first: values.firstSection, last: values.lastSection }
            : null,
      });
      Toast.success(
        values.mode === "renderUnaligned"
          ? "Rendering of unaligned data started successfully!"
          : "Alignment started successfully!",
      );
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
            mode: "align",
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
                {(project.fileCount ?? 0).toLocaleString()} files (
                {formatBytes(project.totalSizeInBytes ?? 0, 1)}), with tile positions listed in{" "}
                <Text code>{project.csvPath}</Text>. The result will be written to a new dataset.
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
                name="mode"
                label="Output"
                extra={
                  renderUnaligned
                    ? "Writes only the unaligned data, e.g. to inspect it before running an alignment."
                    : "Aligns the tiles and sections and writes the aligned data."
                }
              >
                <Radio.Group
                  optionType="button"
                  options={[
                    { value: "align", label: "Align" },
                    { value: "renderUnaligned", label: "Render unaligned only" },
                  ]}
                />
              </Form.Item>
              <Row gutter={24}>
                <Col span={12}>
                  <Form.Item
                    name="newDatasetName"
                    label="Output Dataset Name"
                    rules={[
                      { required: true, message: "Please provide a name for the new dataset" },
                    ]}
                  >
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    name="folderId"
                    label="Target Folder"
                    tooltip="The folder into which the output dataset will be placed."
                  >
                    <FolderSelection disableNotEditableFolders />
                  </Form.Item>
                </Col>
              </Row>
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
                <Text strong>
                  {creditCostInfo != null
                    ? formatMilliCreditsString(creditCostInfo.organizationMilliCredits)
                    : "-"}
                </Text>
              </Col>
            </Row>
            <Divider />
            <Title level={5}>Cost Breakdown:</Title>
            <Row justify="space-between">
              <Col>
                <Text>Output:</Text>
              </Col>
              <Col>
                <Text strong>{getAlignmentRunTypeName(renderUnaligned)}</Text>
              </Col>
            </Row>
            <Row justify="space-between">
              <Col>
                <Text>Sections:</Text>
              </Col>
              <Col>
                <Text strong>
                  {selectedSectionRange != null
                    ? getSectionCount(selectedSectionRange).toLocaleString()
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
                  {costPerSectionInMilliCredits != null
                    ? formatMilliCreditsString(costPerSectionInMilliCredits)
                    : "-"}
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
              disabled={!hasEnoughCredits || isFetchingCost}
              loading={isStarting}
              onClick={handleStart}
            >
              {renderUnaligned ? "Start rendering" : "Start alignment"}
              {costInMilliCredits != null && !hasEnoughCredits ? " (not enough credits)" : ""}
            </Button>
          </Card>
        </Flex>
      </Flex>
    </Modal>
  );
}
