import type { JobCreditCostInfo } from "admin/rest_api";
import { Alert, Row } from "antd";
import { formatCreditsString } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { pluralize } from "libs/utils";

export function JobCreditCostInformation({
  jobCreditCostInfo,
  jobCreditCostPerGVx,
}: {
  jobCreditCostInfo: JobCreditCostInfo | undefined;
  jobCreditCostPerGVx: number;
}) {
  const organizationCreditsFromStore = useWkSelector(
    (state) => state.activeOrganization?.creditBalance || "0",
  );
  const organizationCredits =
    jobCreditCostInfo?.organizationCredits || organizationCreditsFromStore;
  const jobCreditCost = jobCreditCostInfo?.costInCredits;
  const jobCostInfoString =
    jobCreditCost != null ? ` and would cost ${formatCreditsString(jobCreditCost)} credits` : "";
  return (
    <>
      <Row style={{ display: "grid", marginBottom: 16 }}>
        <Alert
          title={
            <>
              Billing for this job is not active during testing phase. This job is billed at{" "}
              {jobCreditCostPerGVx} {pluralize("credit", jobCreditCostPerGVx)} per Gigavoxel
              {jobCostInfoString}. Your organization currently has{" "}
              {formatCreditsString(organizationCredits)} WEBKNOSSOS credits.
            </>
          }
          type="info"
          showIcon
        />
      </Row>
    </>
  );
}
