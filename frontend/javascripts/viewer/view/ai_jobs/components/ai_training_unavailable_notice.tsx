import { useCanRequestUpgrades } from "admin/organization/organization_hooks";
import { AiAddonUpgradeCard } from "admin/organization/plan_upgrade_cards";
import { Alert, Space, Typography } from "antd";

export function AiTrainingUnavailableNotice() {
  const canRequestAiAddon = useCanRequestUpgrades();

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        showIcon
        type="info"
        title="AI training requires the AI add-on"
        description={
          <Typography.Text>
            To train models, your organization needs the AI add-on. This add-on is available for
            Team and Power plans.
          </Typography.Text>
        }
      />
      {canRequestAiAddon ? <AiAddonUpgradeCard /> : null}
    </Space>
  );
}
