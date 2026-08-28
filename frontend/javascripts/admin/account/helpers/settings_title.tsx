import { Divider, Typography } from "antd";

const { Text } = Typography;

export function SettingsTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <Typography.Title level={2} style={{ marginBottom: 0 }}>
        {title}
      </Typography.Title>
      <Text type="secondary" style={{ display: "block" }}>
        {description}
      </Text>
      <Divider style={{ margin: "12px 0 32px 0" }} />
    </div>
  );
}
