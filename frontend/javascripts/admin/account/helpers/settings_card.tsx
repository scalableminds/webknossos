import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Popover, Typography } from "antd";

interface SettingsCardProps {
  title: string;
  description: React.ReactNode;
  explanation?: string;
}

export function SettingsCard({ title, description, explanation }: SettingsCardProps) {
  return (
    <Card>
      <Typography.Text type="secondary" style={{ fontSize: 14 }}>
        {title}
        {explanation != null ? (
          <Popover content={explanation}>
            <InfoCircleOutlined style={{ marginLeft: 8 }} />
          </Popover>
        ) : null}
      </Typography.Text>
      <div style={{ fontSize: 16, marginTop: 4 }}>{description}</div>
    </Card>
  );
}
