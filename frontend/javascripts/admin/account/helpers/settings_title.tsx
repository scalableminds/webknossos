import { Divider, Flex, Typography } from "antd";

const { Text } = Typography;

export function SettingsTitle({
  title,
  description,
  tag,
}: {
  title: string;
  description: string;
  // Shown next to the title, e.g. the organization's plan.
  tag?: React.ReactNode;
}) {
  return (
    <div>
      <Flex align="center" gap={12}>
        <Typography.Title level={2} style={{ marginBottom: 0 }}>
          {title}
        </Typography.Title>
        {tag}
      </Flex>
      <Text type="secondary" style={{ display: "block" }}>
        {description}
      </Text>
      <Divider style={{ margin: "12px 0 32px 0" }} />
    </div>
  );
}
