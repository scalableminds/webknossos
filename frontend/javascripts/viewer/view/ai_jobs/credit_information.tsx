import { CreditCardOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { type JobCreditCostInfo, getJobCreditCost } from "admin/rest_api";
import { Button, Card, Col, Row, Space, Spin, Typography } from "antd";
import features from "features";
import { formatCreditsString, formatVoxels } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox, computeVolumeFromBoundingBox } from "libs/utils";
import type React from "react";
import { useCallback, useMemo } from "react";
import { APIJobType, type AiModel } from "types/api_types";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import type { UserBoundingBox, UserBoundingBoxWithoutId } from "viewer/store";
import { useAlignmentJobContext } from "./alignment/ai_alignment_job_context";
import { useRunAiModelJobContext } from "./run_ai_model/ai_image_segmentation_job_context";
import { useAiTrainingJobContext } from "./train_ai_model/ai_training_job_context";

const { Title, Text } = Typography;

export const RunAiModelCreditInformation: React.FC = () => {
  const { selectedModel, selectedJobType, selectedBoundingBox, handleStartAnalysis } =
    useRunAiModelJobContext();
  return (
    <CreditInformation
      selectedModel={selectedModel}
      selectedJobType={selectedJobType}
      selectedBoundingBox={selectedBoundingBox}
      handleStartAnalysis={handleStartAnalysis}
      startButtonTitle="Start Analysis"
    />
  );
};

export const AlignmentCreditInformation: React.FC = () => {
  const { selectedTask, selectedJobType, selectedBoundingBox, handleStartAnalysis } =
    useAlignmentJobContext();
  return (
    <CreditInformation
      selectedModel={selectedTask}
      selectedJobType={selectedJobType}
      selectedBoundingBox={selectedBoundingBox}
      handleStartAnalysis={handleStartAnalysis}
      startButtonTitle="Start Alignment"
    />
  );
};

export const TrainingCreditInformation: React.FC = () => {
  const { selectedTask, selectedJobType, annotationInfos, handleStartAnalysis } =
    useAiTrainingJobContext();

  // sum all training volumes into a single bounding box
  // This is a shitty way to do it, but it works for now.
  const totalVolume = annotationInfos.reduce(
    (total, { userBoundingBoxes }) =>
      total +
      userBoundingBoxes.reduce(
        (sum, box) => sum + computeVolumeFromBoundingBox(box.boundingBox),
        0,
      ),
    0,
  );
  const side = Math.cbrt(totalVolume);
  const trainingBoundingBox: UserBoundingBoxWithoutId = {
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
      selectedBoundingBox={trainingBoundingBox as UserBoundingBox}
      handleStartAnalysis={handleStartAnalysis}
      startButtonTitle="Start Training"
    />
  );
};

interface CreditInformationProps {
  selectedModel: AiModel | Partial<AiModel> | null;
  selectedJobType: APIJobType | null;
  selectedBoundingBox: UserBoundingBox | null;
  handleStartAnalysis: () => void;
  startButtonTitle: string;
}

export const CreditInformation: React.FC<CreditInformationProps> = ({
  selectedModel,
  selectedJobType,
  selectedBoundingBox,
  handleStartAnalysis,
  startButtonTitle,
}) => {
  const jobTypeToCreditCostPerGVx: Partial<Record<APIJobType, number>> = useMemo(
    () => ({
      [APIJobType.INFER_NUCLEI]: features().neuronInferralCostPerGVx,
      [APIJobType.INFER_NEURONS]: features().neuronInferralCostPerGVx,
      [APIJobType.INFER_MITOCHONDRIA]: features().mitochondriaInferralCostPerGVx,
      [APIJobType.INFER_INSTANCES]: features().neuronInferralCostPerGVx,
      [APIJobType.ALIGN_SECTIONS]: features().alignmentCostPerGVx,
      [APIJobType.TRAIN_INSTANCE_MODEL]: 0,
      [APIJobType.TRAIN_NEURON_MODEL]: 0,
    }),
    [],
  );

  const organizationCredits = useWkSelector(
    (state) => state.activeOrganization?.creditBalance || "0",
  );

  const { data: jobCreditCostInfo, isFetching } = useQuery<JobCreditCostInfo>({
    queryKey: [
      "jobCreditCost",
      selectedJobType ?? "no-type",
      selectedBoundingBox?.boundingBox ?? "no-bb",
    ],
    queryFn: async () =>
      await getJobCreditCost(
        selectedJobType!,
        computeArrayFromBoundingBox(selectedBoundingBox!.boundingBox),
      ),
    enabled: Boolean(selectedBoundingBox && selectedJobType),
  });

  const getBoundingBoxinVoxels = useCallback((): string => {
    if (selectedBoundingBox) {
      const bbVolumeInVx = new BoundingBox(selectedBoundingBox.boundingBox).getVolume();
      return formatVoxels(bbVolumeInVx);
    }
    return "-";
  }, [selectedBoundingBox]);

  const costInCredits = jobCreditCostInfo?.costInCredits;

  return (
    <Card
      title={
        <Space align="center">
          <CreditCardOutlined style={{ color: "#ddbc00" }} />
          Credit Information
        </Space>
      }
    >
      <Row justify="space-between" align="middle">
        <Col>
          <Text>Available Credits</Text>
        </Col>
        <Col>
          <Title level={2} style={{ margin: 0 }}>
            {formatCreditsString(organizationCredits)}
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
          <Text strong>{selectedJobType ? jobTypeToCreditCostPerGVx[selectedJobType] : "-"}</Text>
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
            <Text strong>{costInCredits ? formatCreditsString(costInCredits) : "-"}</Text>
          )}
        </Col>
      </Row>
      <Button
        type="primary"
        block
        size="large"
        style={{ marginTop: "24px" }}
        disabled={!selectedModel || !selectedBoundingBox || !jobCreditCostInfo?.hasEnoughCredits}
        onClick={handleStartAnalysis}
      >
        {startButtonTitle}
      </Button>
    </Card>
  );
};
