import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Flex, Popover, Space, Typography } from "antd";

export type SettingsCardProps = {
  title: string;
  content: React.ReactNode;
  tooltip?: React.ReactNode;
  action?: React.ReactNode;
  style?: React.CSSProperties;
};

export function SettingsCard({ title, content, tooltip, action, style }: SettingsCardProps) {
  return (
    <Card style={{ minHeight: 105, ...style }}>
      <Typography.Text type="secondary">
        <Flex justify="space-between">
          <Space size="small">
            {title}
            {tooltip != null ? (
              <Popover
                content={tooltip}
                styles={{
                  container: {
                    maxWidth: 250,
                    wordWrap: "break-word",
                  },
                }}
              >
                <InfoCircleOutlined />
              </Popover>
            ) : null}
          </Space>
          {action}
        </Flex>
      </Typography.Text>
      <div style={{ fontSize: "var(--ant-font-size-lg)"}}>{content}</div>
    </Card>
  );
}
