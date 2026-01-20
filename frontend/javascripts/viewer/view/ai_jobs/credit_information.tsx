import { CreditCardOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { type JobCreditCostInfo, getJobCreditCostAndUpdateOrgaCredits } from "admin/rest_api";
import { Button, Card, Col, Flex, Row, Space, Spin, Typography } from "antd";
import features from "features";
import { formatMilliCreditsString, formatVoxels } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox, computeVolumeFromBoundingBox } from "libs/utils";
import type React from "react";
import { useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import { APIJobCommand, type AiModel } from "types/api_types";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import type { UserBoundingBox } from "viewer/store";
import { useAlignmentJobContext } from "./alignment/ai_alignment_job_context";
import { useRunAiModelJobContext } from "./run_ai_model/ai_image_segmentation_job_context";
import { useAiTrainingJobContext } from "./train_ai_model/ai_training_job_context";

const { Title, Text } = Typography;

export const RunAiModelCreditInformation: React.FC = () => {
  const {
    selectedModel,
    selectedJobType,
    selectedBoundingBox,
    handleStartAnalysis,
    areParametersValid,
  } = useRunAiModelJobContext();
  return (
    <CreditInformation
      selectedModel={selectedModel}
      selectedJobType={selectedJobType}
      selectedBoundingBox={selectedBoundingBox}
      handleStartAnalysis={handleStartAnalysis}
      startButtonTitle="Start Analysis"
      areParametersValid={areParametersValid}
    />
  );
};

export const AlignmentCreditInformation: React.FC = () => {
  const { selectedTask, selectedBoundingBox, handleStartAnalysis, areParametersValid } =
    useAlignmentJobContext();
  const selectJobType = selectedTask?.jobType ?? null;

  return (
    <CreditInformation
      selectedModel={selectedTask}
      selectedJobType={selectJobType}
      selectedBoundingBox={selectedBoundingBox}
      handleStartAnalysis={handleStartAnalysis}
      startButtonTitle="Start Alignment"
      areParametersValid={areParametersValid}
    />
  );
};

export const TrainingCreditInformation: React.FC = () => {
  const {
    selectedTask,
    selectedJobType,
    selectedAnnotations,
    handleStartAnalysis,
    areParametersValid,
  } = useAiTrainingJobContext();

  // Create a synthetic cubic bounding box from the total training volume
  // for cost calculation purposes.
  const totalVolume = selectedAnnotations.reduce(
    (total, { userBoundingBoxes }) =>
      total +
      userBoundingBoxes.reduce(
        (sum, box) => sum + computeVolumeFromBoundingBox(box.boundingBox),
        0,
      ),
    0,
  );
  // bounding box sizing needs to be integer values
  const side = Math.round(Math.cbrt(totalVolume));
  const trainingBoundingBox: UserBoundingBox = {
    id: -1, // Synthetic ID for training volume calculation
    boundingBox: {
      min: [0, 0, 0],
      max: [side, side, side],
    },
    name: "Training Volume",
    color: [0, 0, 1],
    isVisible: false,
  };

  return (
    <CreditInformation
      selectedModel={selectedTask}
      selectedJobType={selectedJobType}
      selectedBoundingBox={trainingBoundingBox}
      handleStartAnalysis={handleStartAnalysis}
      startButtonTitle="Start Training"
      areParametersValid={areParametersValid}
    />
  );
};

interface CreditInformationProps {
  selectedModel: AiModel | Partial<AiModel> | null;
  selectedJobType: APIJobCommand | null;
  selectedBoundingBox: UserBoundingBox | null;
  handleStartAnalysis: () => void;
  startButtonTitle: string;
  areParametersValid: boolean;
}

export const CreditInformation: React.FC<CreditInformationProps> = ({
  selectedModel,
  selectedJobType,
  selectedBoundingBox,
  handleStartAnalysis,
  startButtonTitle,
  areParametersValid,
}) => {
  const jobTypeToCreditCostPerGVxInMillis: Partial<Record<APIJobCommand, number>> = useMemo(
    () => ({
      [APIJobCommand.INFER_NEURONS]: features().neuronInferralCostInMilliCreditsPerGVx,
      [APIJobCommand.INFER_NUCLEI]: features().nucleiInferralCostInMilliCreditsPerGVx,
      [APIJobCommand.INFER_MITOCHONDRIA]: features().mitochondriaInferralCostInMilliCreditsPerGVx,
      [APIJobCommand.INFER_INSTANCES]: features().instancesInferralCostInMilliCreditsPerGVx,
      [APIJobCommand.ALIGN_SECTIONS]: features().alignmentCostInMilliCreditsPerGVx,
      [APIJobCommand.TRAIN_INSTANCE_MODEL]: 0,
      [APIJobCommand.TRAIN_NEURON_MODEL]: 0,
    }),
    [],
  );

  const organizationMilliCredits = useWkSelector(
    (state) => state.activeOrganization?.milliCreditBalance || 0,
  );

  const boundingBoxVolume = useMemo(() => {
    if (selectedBoundingBox) {
      return new BoundingBox(selectedBoundingBox.boundingBox).getVolume();
    }
    return 0;
  }, [selectedBoundingBox]);

  const { data: jobCreditCostInfo, isFetching } = useQuery<JobCreditCostInfo>({
    queryKey: [
      "jobCreditCost",
      selectedJobType ?? "no-type",
      selectedBoundingBox?.boundingBox ?? "no-bb",
    ],
    queryFn: async () =>
      await getJobCreditCostAndUpdateOrgaCredits(
        selectedJobType!,
        computeArrayFromBoundingBox(selectedBoundingBox!.boundingBox),
      ),
    enabled: Boolean(selectedBoundingBox && selectedJobType),
  });

  const getBoundingBoxinVoxels = useCallback((): string => {
    if (selectedBoundingBox) {
      return formatVoxels(boundingBoxVolume);
    }
    return "-";
  }, [selectedBoundingBox, boundingBoxVolume]);

  const costInCredits = jobCreditCostInfo?.costInMilliCredits;

  return (
    <Card
      type="inner"
      title={
        <Space align="center">
          <CreditCardOutlined style={{ color: "#ddbc00" }} />
          Credit Information
        </Space>
      }
      style={{
        position: "sticky",
        top: 0,
      }}
    >
      <Row justify="space-between" align="middle">
        <Col>
          <Text>Available Credits</Text>
        </Col>
        <Col>
          <Title level={2} style={{ margin: 0 }}>
            {formatMilliCreditsString(organizationMilliCredits)}
          </Title>
        </Col>
      </Row>
      <hr style={{ margin: "24px 0" }} />
      <Title level={5}>Cost Breakdown:</Title>
      <Row justify="space-between">
        <Col>
          <Text>Selected Model:</Text>
        </Col>
        <Col>
          <Text strong>{selectedModel ? selectedModel.name : "-"}</Text>
        </Col>
      </Row>
      <Row justify="space-between">
        <Col>
          <Text>Dataset Size:</Text>
        </Col>
        <Col>
          <Text strong>{getBoundingBoxinVoxels()}</Text>
        </Col>
      </Row>
      <Row justify="space-between">
        <Col>
          <Text>Credits per Gigavoxel:</Text>
        </Col>
        <Col>
          <Text strong>
            {selectedJobType && jobTypeToCreditCostPerGVxInMillis[selectedJobType] != null
              ? formatMilliCreditsString(jobTypeToCreditCostPerGVxInMillis[selectedJobType])
              : "-"}
          </Text>
        </Col>
      </Row>
      <hr style={{ margin: "24px 0" }} />
      <Row justify="space-between">
        <Col>
          <Text>Total Cost:</Text>
        </Col>
        <Col>
          {isFetching && selectedBoundingBox && selectedModel ? (
            <Spin size="small" />
          ) : (
            <Text strong>
              {costInCredits != null ? `${formatMilliCreditsString(costInCredits)} credits` : "-"}
            </Text>
          )}
        </Col>
      </Row>
      <Flex vertical gap="small">
        <Button
          type="primary"
          block
          size="large"
          style={{ marginTop: "24px" }}
          disabled={
            !selectedModel ||
            !selectedBoundingBox ||
            !jobCreditCostInfo?.hasEnoughCredits ||
            boundingBoxVolume === 0 ||
            !areParametersValid
          }
          onClick={handleStartAnalysis}
        >
          {startButtonTitle}
          {jobCreditCostInfo?.hasEnoughCredits === false ? " (Not enough credits)" : ""}
        </Button>
        {jobCreditCostInfo?.hasEnoughCredits === false && (
          <Link to={"/organization"}>
            <Button block>Order more Credits</Button>
          </Link>
        )}
      </Flex>
    </Card>
  );
};
