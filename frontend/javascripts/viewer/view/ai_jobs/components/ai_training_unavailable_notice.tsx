import { AiAddonUpgradeCard } from "admin/organization/organization_cards";
import { Alert, Space, Typography } from "antd";

export function AiTrainingUnavailableNotice({
  onRequestUpgrade,
  canRequestAiAddon,
  isEligibleForAiAddon,
}: {
  onRequestUpgrade?: () => void;
  canRequestAiAddon: boolean;
  isEligibleForAiAddon: boolean;
}) {
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
      {isEligibleForAiAddon ? (
        <AiAddonUpgradeCard
          description="Unlock AI model training for your organization."
          onRequestUpgrade={canRequestAiAddon ? onRequestUpgrade : undefined}
        />
      ) : null}
    </Space>
  );
}
