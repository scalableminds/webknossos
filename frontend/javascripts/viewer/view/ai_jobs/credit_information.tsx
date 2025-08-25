import { type JobCreditCostInfo, getJobCreditCost } from "admin/rest_api";
import { Button, Card, Col, Row, Spin, Typography } from "antd";
import { formatCreditsString, formatVoxels } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox } from "libs/utils";
import type React from "react";
import { useRunAiModelJobContext } from "./run_ai_model/ai_image_segmentation_job_context";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import { useCallback, useMemo } from "react";
import { APIJobType } from "types/api_types";
import features from "features";

const { Title, Text } = Typography;

export const CreditInformation: React.FC = () => {
  const jobTypeToCreditCostPerGVx: Record<APIJobType, number> = useMemo(
    () => ({
      [APIJobType.INFER_NUCLEI]: features().neuronInferralCostPerGVx,
      [APIJobType.INFER_NEURONS]: features().neuronInferralCostPerGVx,
      [APIJobType.INFER_MITOCHONDRIA]: features().mitochondriaInferralCostPerGVx,
      [APIJobType.INFER_INSTANCES]: features().neuronInferralCostPerGVx,
    }),
    [],
  );

  const { selectedModel, selectedJobType, selectedBoundingBox, handleStartAnalysis } =
    useRunAiModelJobContext();
  const organizationCredits = useWkSelector(
    (state) => state.activeOrganization?.creditBalance || "0",
  );

  const jobCreditCostInfo = useFetch<JobCreditCostInfo | undefined>(
    async () =>
      selectedBoundingBox && selectedJobType
        ? await getJobCreditCost(
            selectedJobType,
            computeArrayFromBoundingBox(selectedBoundingBox.boundingBox),
          )
        : undefined,
    undefined,
    [selectedBoundingBox, selectedJobType],
  );

  const getBoundingBoxinVoxels = useCallback((): string => {
    if (selectedBoundingBox) {
      const bbVolumeInVx = new BoundingBox(selectedBoundingBox.boundingBox).getVolume();
      return formatVoxels(bbVolumeInVx);
    }
    return "-";
  }, [selectedBoundingBox]);

  const costInCredits = jobCreditCostInfo?.costInCredits;

  return (
    <Card title="Credit Information">
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
          {jobCreditCostInfo === undefined && selectedBoundingBox && selectedModel ? (
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
        Start Analysis
      </Button>
    </Card>
  );
};
