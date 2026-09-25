import { CreditCardOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { hasPricingPlanExceededStorage } from "admin/organization/pricing_plan_utils";
import { getJobCreditCostAndUpdateOrgaCredits, type JobCreditCostInfo } from "admin/rest_api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Flex,
  Space,
  Spin,
  Tooltip,
  Typography,
  theme,
} from "antd";
import features from "features";
import { formatMilliCreditsString, formatVoxels } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox, computeVolumeFromBoundingBox } from "libs/utils";
import type React from "react";
import { useCallback, useMemo } from "react";
import { Link } from "react-router";
import { ColorWKGold } from "theme";
import { APIJobCommand } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getMagInfo } from "viewer/model/accessors/dataset_accessor";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import type { UserBoundingBox } from "viewer/store";
import { useAlignmentJobContext } from "./alignment/ai_alignment_job_context";
import type { JobRequirement } from "./components/job_requirements";
import { JOB_COMMANDS_WRITING_TO_STORAGE } from "./constants";
import { useRunAiModelJobContext } from "./run_ai_model/ai_image_segmentation_job_context";
import { useAiTrainingJobContext } from "./train_ai_model/ai_training_job_context";
import { getBestFittingMagComparedToTrainingDS } from "./utils";

const { Title, Text } = Typography;

function mag1BboxToMag(mag1Bbox: UserBoundingBox, mag: Vector3): UserBoundingBox {
  return {
    ...mag1Bbox,
    boundingBox: new BoundingBox(mag1Bbox.boundingBox).fromMag1ToMag(mag).toBoundingBoxMinMaxType(),
  };
}

export const RunAiModelCreditInformation: React.FC = () => {
  const {
    selectedModel,
    selectedJobType,
    selectedBoundingBox,
    selectedLayer,
    handleStartAnalysis,
    areParametersValid,
    requirements,
  } = useRunAiModelJobContext();
  const dataset = useWkSelector((state) => state.dataset);

  const aiModelId = selectedModel?.id;

  const { data: adjustedBoundingBox } = useQuery<UserBoundingBox | null>({
    queryKey: [
      "boundingBoxForCreditCost",
      selectedBoundingBox?.boundingBox,
      selectedJobType,
      aiModelId,
      selectedLayer?.name,
    ],
    queryFn: async () => {
      if (!selectedLayer || !selectedBoundingBox || !selectedJobType) return null;

      const mag = await getBestFittingMagComparedToTrainingDS(
        selectedLayer,
        dataset.dataSource.scale,
        selectedJobType,
        aiModelId,
        false,
      );

      return mag1BboxToMag(selectedBoundingBox, mag);
    },
    enabled: Boolean(selectedBoundingBox && selectedJobType && selectedLayer),
  });

  return (
    <CreditInformation
      selectedModel={selectedModel}
      selectedJobType={selectedJobType}
      selectedBoundingBox={adjustedBoundingBox ?? null}
      handleStartAnalysis={handleStartAnalysis}
      startButtonTitle="Start analysis"
      areParametersValid={areParametersValid}
      requirements={requirements}
    />
  );
};

export const AlignmentCreditInformation: React.FC = () => {
  const {
    selectedTask,
    selectedBoundingBox,
    colorLayer,
    handleStartAnalysis,
    areParametersValid,
    requirements,
  } = useAlignmentJobContext();
  const selectJobType = selectedTask?.jobType ?? null;

  const adjustedBoundingBox = useMemo(() => {
    if (!selectedBoundingBox) return null;
    const mag = getMagInfo(colorLayer.mags).getFinestMag();
    return mag1BboxToMag(selectedBoundingBox, mag);
  }, [selectedBoundingBox, colorLayer]);

  return (
    <CreditInformation
      selectedModel={selectedTask}
      selectedJobType={selectJobType}
      selectedBoundingBox={adjustedBoundingBox}
      handleStartAnalysis={handleStartAnalysis}
      startButtonTitle="Start alignment"
      areParametersValid={areParametersValid}
      requirements={requirements}
      selectionLabel="Selected task"
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
    requirements,
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
      startButtonTitle="Start training"
      areParametersValid={areParametersValid}
      requirements={requirements}
      selectionLabel="Selected task"
      volumeLabel="Training volume"
    />
  );
};

interface CreditInformationProps {
  selectedModel: { name?: string } | null;
  selectedJobType: APIJobCommand | null;
  selectedBoundingBox: UserBoundingBox | null;
  handleStartAnalysis: () => void;
  startButtonTitle: string;
  areParametersValid: boolean;
  requirements: JobRequirement[];
  selectionLabel?: string;
  // Without a custom label, the volume is labeled as the (bounding box restricted) dataset size.
  volumeLabel?: string;
}

function CreditRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  const { cssVar } = theme.useToken();
  return (
    <Flex justify="space-between" gap="small">
      <Text style={{ color: cssVar.colorTextSecondary }}>{label}</Text>
      <Text strong style={{ textAlign: "right" }}>
        {value}
      </Text>
    </Flex>
  );
}

function BeforeYouStart({ requirements }: { requirements: JobRequirement[] }) {
  const { cssVar } = theme.useToken();
  return (
    <div
      style={{
        background: cssVar.colorFillAlter,
        borderRadius: cssVar.borderRadiusLG,
        padding: "12px 16px",
      }}
    >
      <Text strong style={{ display: "block", marginBottom: 6 }}>
        Before you start
      </Text>
      {requirements.map(({ label, severity }) => (
        <Flex key={label} gap="small" align="baseline">
          <Badge status={severity === "error" ? "error" : "warning"} />
          <Text style={{ color: cssVar.colorTextSecondary }}>{label}</Text>
        </Flex>
      ))}
    </div>
  );
}

const CreditInformation: React.FC<CreditInformationProps> = ({
  selectedModel,
  selectedJobType,
  selectedBoundingBox,
  handleStartAnalysis,
  startButtonTitle,
  areParametersValid,
  requirements,
  selectionLabel = "Selected model",
  volumeLabel,
}) => {
  const { cssVar } = theme.useToken();
  const jobTypeToCreditCostPerGVxInMillis: Partial<Record<APIJobCommand, number>> = useMemo(
    () => ({
      [APIJobCommand.INFER_NEURONS]: features().neuronInferralCostInMilliCreditsPerGVx,
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

  const isBlockedByStorageQuota = useWkSelector(
    (state) =>
      selectedJobType != null &&
      JOB_COMMANDS_WRITING_TO_STORAGE.has(selectedJobType) &&
      state.activeOrganization != null &&
      hasPricingPlanExceededStorage(state.activeOrganization),
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

  const isSubmitDisabled =
    isFetching ||
    !selectedModel ||
    !selectedBoundingBox ||
    !jobCreditCostInfo?.hasEnoughCredits ||
    boundingBoxVolume === 0 ||
    !areParametersValid ||
    isBlockedByStorageQuota;

  let startButtonSuffix = "";
  if (isBlockedByStorageQuota) {
    startButtonSuffix = " (storage quota exceeded)";
  } else if (jobCreditCostInfo?.hasEnoughCredits === false) {
    startButtonSuffix = " (not enough credits)";
  }

  return (
    <Card style={{ boxShadow: cssVar.boxShadowTertiary }}>
      <Flex align="center" gap="small" style={{ marginBottom: 16 }}>
        <CreditCardOutlined style={{ color: ColorWKGold, fontSize: cssVar.fontSizeLG }} />
        <Text strong style={{ fontSize: cssVar.fontSizeLG }}>
          Credit information
        </Text>
      </Flex>
      <Flex
        justify="space-between"
        align="center"
        style={{
          background: cssVar.colorFillAlter,
          borderRadius: cssVar.borderRadiusLG,
          padding: "12px 16px",
          marginBottom: 20,
        }}
      >
        <Text>Available credits</Text>
        <Text strong>{formatMilliCreditsString(organizationMilliCredits)}</Text>
      </Flex>
      <Flex vertical gap="small">
        <CreditRow label={selectionLabel} value={selectedModel?.name ?? "-"} />
        <CreditRow
          label={
            volumeLabel ?? (
              <Space size="small">
                Dataset size
                <Tooltip title="Displayed size respects selected bounding boxes and magnifications.">
                  <InfoCircleOutlined />
                </Tooltip>
              </Space>
            )
          }
          value={getBoundingBoxinVoxels()}
        />
        <CreditRow
          label="Credits per gigavoxel"
          value={
            selectedJobType && jobTypeToCreditCostPerGVxInMillis[selectedJobType] != null
              ? formatMilliCreditsString(jobTypeToCreditCostPerGVxInMillis[selectedJobType])
              : "-"
          }
        />
      </Flex>
      <Divider style={{ margin: "20px 0" }} />
      <Flex justify="space-between" align="baseline" style={{ marginBottom: 20 }}>
        <Text strong>Total cost</Text>
        {isFetching && selectedBoundingBox && selectedModel ? (
          <Spin size="small" />
        ) : (
          <Title level={3} style={{ margin: 0 }}>
            {costInCredits != null ? `${formatMilliCreditsString(costInCredits)} credits` : "-"}
          </Title>
        )}
      </Flex>
      <Flex vertical gap="middle">
        {isBlockedByStorageQuota && (
          <Alert
            showIcon
            type="error"
            title="Storage quota exceeded"
            description={
              <Text>
                Your organization has exceeded the available storage, so the results of this job
                could not be stored. Visit the <Link to="/organization">organization page</Link> for
                details.
              </Text>
            }
          />
        )}
        <Button
          type="primary"
          block
          size="large"
          disabled={isSubmitDisabled}
          onClick={handleStartAnalysis}
        >
          {startButtonTitle}
          {startButtonSuffix}
        </Button>
        {isSubmitDisabled && requirements.length > 0 && (
          <BeforeYouStart requirements={requirements} />
        )}
        {jobCreditCostInfo?.hasEnoughCredits === false && (
          <Link to={"/organization"}>
            <Button block>Order more Credits</Button>
          </Link>
        )}
      </Flex>
    </Card>
  );
};
