import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Flex, Popover, Typography } from "antd";

interface SettingsCardProps {
  title: string;
  description: React.ReactNode;
  explanation?: React.ReactNode;
  action?: React.ReactNode;
}

export function SettingsCard({ title, description, explanation, action }: SettingsCardProps) {
  return (
    <Card style={{ minHeight: 105 }}>
      <Typography.Text type="secondary" style={{ fontSize: 14 }}>
        <Flex justify="space-between">
          <div>
            {title}

            {explanation != null ? (
              <Popover content={explanation}>
                <InfoCircleOutlined style={{ marginLeft: 4 }} />
              </Popover>
            ) : null}
          </div>
          {action}
        </Flex>
      </Typography.Text>
      <div style={{ fontSize: 16, marginTop: 4 }}>{description}</div>
    </Card>
  );
}
