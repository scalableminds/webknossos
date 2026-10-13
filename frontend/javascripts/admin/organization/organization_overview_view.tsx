import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getPricingPlanStatus } from "admin/api/organization";
import { Col, Row, Space, Spin } from "antd";
import { useQueryWithErrorHandling } from "libs/react_hooks";
import {
  PlanAboutToExceedAlert,
  PlanExceededAlert,
  PlanExpirationCard,
} from "./organization_cards";
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
import { getActiveUserCount } from "./pricing_plan_utils";

export function OrganizationOverviewView() {
  const organization = useActiveOrganization();
  const { data: users = [], isFetching: isFetchingUsers } = useOrganizationUsers();
  const { data: pricingPlanStatus, isFetching: isFetchingPlanStatus } = useQueryWithErrorHandling(
    { queryKey: ["pricingPlanStatus"], queryFn: getPricingPlanStatus },
    "Could not load pricing plan status.",
  );

  return (
    <>
      <SettingsTitle title={organization.name} description="Manage your organization." />
      {pricingPlanStatus?.isExceeded ? <PlanExceededAlert organization={organization} /> : null}
      {pricingPlanStatus?.isAlmostExceeded && !pricingPlanStatus.isExceeded ? (
        <PlanAboutToExceedAlert organization={organization} />
      ) : null}
      <Space orientation="vertical" size="large" style={{ width: "100%" }}>
        <Spin spinning={isFetchingUsers || isFetchingPlanStatus}>
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
