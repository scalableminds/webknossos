import type { JobCreditCostInfo } from "admin/rest_api";
import { Alert, Row } from "antd";
import { formatMilliCreditsString } from "libs/format_utils";
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
    (state) => state.activeOrganization?.creditBalanceInMillis || 0,
  );
  const organizationCredits =
    jobCreditCostInfo?.organizationMilliCredits || organizationCreditsFromStore;
  const jobCreditCost = jobCreditCostInfo?.costInMilliCredits;
  const jobCostInfoString =
    jobCreditCost != null
      ? ` and would cost ${formatMilliCreditsString(jobCreditCost)} credits`
      : "";
  return (
    <>
      <Row style={{ display: "grid", marginBottom: 16 }}>
        <Alert
          message={
            <>
              Billing for this job is not active during testing phase. This job is billed at{" "}
              {jobCreditCostPerGVx} {pluralize("credit", jobCreditCostPerGVx)} per Gigavoxel
              {jobCostInfoString}. Your organization currently has{" "}
              {formatMilliCreditsString(organizationCredits)} WEBKNOSSOS credits.
            </>
          }
          type="info"
          showIcon
        />
      </Row>
    </>
  );
}
