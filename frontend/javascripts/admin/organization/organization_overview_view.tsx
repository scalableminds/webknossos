import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getPricingPlanStatus } from "admin/api/organization";
import { Col, Row, Space, Spin } from "antd";
import { useQueryWithErrorHandling } from "libs/react_hooks";
import { PlanExceededAlert, PlanExpirationCard } from "./organization_cards";
import { useActiveOrganization, useOrganizationUsers } from "./organization_hooks";
import {
  AiAddonCard,
  CreditBalanceCard,
  OrganizationNameCard,
  OrganizationOwnerCard,
  PricingPlanCard,
  StorageQuotaCard,
  UsersQuotaCard,
} from "./organization_stat_cards";
import { UpgradeOfferCards } from "./plan_upgrade_cards";
import { getActiveUserCount, hasPricingPlanExpired } from "./pricing_plan_utils";

export function OrganizationOverviewView() {
  const organization = useActiveOrganization();
  // Cached data is shown right away, so only spin while there is none yet.
  const { data: users = [], isLoading: isLoadingUsers } = useOrganizationUsers();
  const { data: pricingPlanStatus, isLoading: isLoadingPlanStatus } = useQueryWithErrorHandling(
    { queryKey: ["pricingPlanStatus"], queryFn: getPricingPlanStatus },
    "Could not load pricing plan status.",
  );

  return (
    <>
      <SettingsTitle title={organization.name} description="Manage your organization." />
      {/* PlanExpirationCard already covers expired and expiring plans, so only over-limit usage gets an alert. */}
      {pricingPlanStatus?.isExceeded && !hasPricingPlanExpired(organization) ? (
        <PlanExceededAlert organization={organization} />
      ) : null}
      <Space orientation="vertical" size="large" style={{ width: "100%" }}>
        <Spin spinning={isLoadingUsers || isLoadingPlanStatus}>
          <Space orientation="vertical" size={24} style={{ width: "100%" }}>
            <Row gutter={[24, 24]}>
              <Col span={8}>
                <OrganizationNameCard />
              </Col>
              <Col span={8}>
                <OrganizationOwnerCard />
              </Col>
              <Col span={8}>
                <PricingPlanCard />
              </Col>
            </Row>
            <Row gutter={[24, 24]}>
              <Col span={6}>
                <UsersQuotaCard activeUsersCount={getActiveUserCount(users)} />
              </Col>
              <Col span={6}>
                <StorageQuotaCard />
              </Col>
              <Col span={6}>
                <CreditBalanceCard />
              </Col>
              <Col span={6}>
                <AiAddonCard />
              </Col>
            </Row>
            <PlanExpirationCard organization={organization} />
          </Space>
        </Spin>
        <UpgradeOfferCards organization={organization} />
      </Space>
    </>
  );
}
