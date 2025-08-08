import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Flex, Popover, Typography } from "antd";

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
      <Typography.Text type="secondary" style={{ fontSize: 14 }}>
        <Flex justify="space-between">
          <div>
            {title}

            {tooltip != null ? (
              <Popover
                content={tooltip}
                overlayInnerStyle={{
                  maxWidth: 250,
                  wordWrap: "break-word",
                }}
              >
                <InfoCircleOutlined style={{ marginLeft: 8 }} />
              </Popover>
            ) : null}
          </div>
          {action}
        </Flex>
      </Typography.Text>
      <div style={{ fontSize: 16, marginTop: 4 }}>{content}</div>
    </Card>
  );
}
