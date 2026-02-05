import { AiAddonUpgradeCard } from "admin/organization/organization_cards";
import { isUserAllowedToRequestUpgrades } from "admin/organization/pricing_plan_utils";
import { Alert, Space, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";

export function AiTrainingUnavailableNotice() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const canRequestAiAddon = activeUser ? isUserAllowedToRequestUpgrades(activeUser) : false;

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
