import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Flex, Tooltip, Typography } from "antd";

export type SettingsCardProps = {
  title: string;
  content: React.ReactNode;
  tooltip?: React.ReactNode;
  action?: React.ReactNode;
};

export function SettingsCard({ title, content, tooltip, action }: SettingsCardProps) {
  return (
    <Card style={{ minHeight: 105 }}>
      <Typography.Text type="secondary" style={{ fontSize: 14 }}>
        <Flex justify="space-between">
          <div>
            {title}

            {tooltip != null ? (
              <Tooltip title={tooltip}>
                <InfoCircleOutlined style={{ marginLeft: 4 }} />
              </Tooltip>
            ) : null}
          </div>
          {action}
        </Flex>
      </Typography.Text>
      <div style={{ fontSize: 16, marginTop: 4 }}>{content}</div>
    </Card>
  );
}
