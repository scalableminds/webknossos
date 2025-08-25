import { type JobCreditCostInfo, getJobCreditCost } from "admin/rest_api";
import { Button, Card, Col, Row, Spin, Typography } from "antd";
import { formatCreditsString } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox } from "libs/utils";
import type React from "react";
import { useRunAiModelJobContext } from "./run_ai_model/ai_image_segmentation_job_context";

const { Title, Text } = Typography;

export const CreditInformation: React.FC = () => {
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
          <Text>Dataset Size (Est.):</Text>
        </Col>
        <Col>
          <Text strong>{selectedBoundingBox ? "Selected" : "-"}</Text>
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
            <Text strong>{costInCredits ? formatCreditsString(costInCredits) : "FREE"}</Text>
          )}
        </Col>
      </Row>
      <Button
        type="primary"
        block
        size="large"
        style={{ marginTop: "24px" }}
        disabled={!selectedModel || !selectedBoundingBox}
        onClick={handleStartAnalysis}
      >
        Start Analysis
      </Button>
    </Card>
  );
};
