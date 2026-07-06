import { CrownOutlined, PlusCircleOutlined } from "@ant-design/icons";
import { Button, Card, Space } from "antd";
import { PricingPlanEnum, powerPlanFeatures, teamPlanFeatures } from "./pricing_plan_utils";

export function TeamPlanUpgradeCard({ teamUpgradeCallback }: { teamUpgradeCallback: () => void }) {
  return (
    <Card
      title={
        <Space size="small">
          <CrownOutlined style={{ color: "var(--ant-color-primary)" }} />
          {PricingPlanEnum.Team} Plan
        </Space>
      }
      styles={{ body: { minHeight: 220 } }}
      actions={[
        <Button
          type="primary"
          onClick={teamUpgradeCallback}
          key="buy-teamupgrade-button"
          icon={<PlusCircleOutlined />}
        >
          Buy Upgrade
        </Button>,
      ]}
    >
      <ul>
        {teamPlanFeatures.map((feature) => (
          <li key={feature.slice(0, 10)}>{feature}</li>
        ))}
      </ul>
    </Card>
  );
}

export function PowerPlanUpgradeCard({
  powerUpgradeCallback,
  description,
}: {
  powerUpgradeCallback: () => void;
  description?: string;
}) {
  return (
    <Card
      title={
        <Space size="small">
          <CrownOutlined style={{ color: "var(--ant-color-primary)" }} />
          {PricingPlanEnum.Power} Plan
        </Space>
      }
      styles={{ body: { minHeight: 220 } }}
      actions={[
        <Button
          type="primary"
          onClick={powerUpgradeCallback}
          key="buy-power-upgrade-button"
          icon={<PlusCircleOutlined />}
        >
          Buy Upgrade
        </Button>,
      ]}
    >
      <div>
        {description ? <p>{description}</p> : null}
        <ul>
          {powerPlanFeatures.map((feature) => (
            <li key={feature.slice(0, 10)}>{feature}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
