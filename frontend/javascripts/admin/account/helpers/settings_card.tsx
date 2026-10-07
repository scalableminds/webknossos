import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Flex, Popover, Progress, Space, Typography, theme } from "antd";

// From this fill level on, a meter (and its hint) is shown as a warning.
// Above 1, i.e. over the limit, it is shown as an error.
const METER_WARNING_THRESHOLD = 0.8;

export type SettingsCardProps = {
  title: string;
  content: React.ReactNode;
  tooltip?: React.ReactNode;
  // Small control at the top right, e.g. a round edit button.
  action?: React.ReactNode;
  style?: React.CSSProperties;
  // Shown before the value. Colored with the primary color unless the icon sets its own color.
  icon?: React.ReactNode;
  // "stat" renders the value larger, for numbers like "4 / 5".
  size?: "default" | "stat";
  // Fill level, e.g. for usage quotas. 1 means the limit is reached, above 1 it is exceeded.
  meter?: number;
  // One short line below the value.
  hint?: React.ReactNode;
  hintType?: "secondary" | "warning" | "danger";
  // Labeled button at the bottom of the card, e.g. "Add users".
  footerAction?: React.ReactNode;
  // Additional content below the value row, e.g. an edit form.
  children?: React.ReactNode;
};

function isMeterWarning(meter: number | undefined): boolean {
  return meter != null && meter >= METER_WARNING_THRESHOLD;
}

function isMeterExceeded(meter: number | undefined): boolean {
  return meter != null && meter > 1;
}

export function SettingsCard({
  title,
  content,
  tooltip,
  action,
  style,
  icon,
  size = "default",
  meter,
  hint,
  hintType,
  footerAction,
  children,
}: SettingsCardProps) {
  const { token } = theme.useToken();
  const derivedHintType = isMeterExceeded(meter)
    ? "danger"
    : isMeterWarning(meter)
      ? "warning"
      : "secondary";
  const effectiveHintType = hintType ?? derivedHintType;

  // Cards without an icon keep the plain value style, since their content is usually a form.
  const valueRow =
    icon != null ? (
      <Flex align="center" gap={8}>
        <span style={{ fontSize: 20, lineHeight: 1, color: token.colorPrimary, flex: "none" }}>
          {icon}
        </span>
        <Typography.Text
          strong
          style={{
            fontSize: size === "stat" ? 20 : 16,
            minWidth: 0,
            overflowWrap: "anywhere",
          }}
        >
          {content}
        </Typography.Text>
      </Flex>
    ) : (
      <div style={{ fontSize: 16 }}>{content}</div>
    );

  return (
    <Card
      style={{ minHeight: 105, height: "100%", ...style }}
      styles={{ body: { height: "100%" } }}
    >
      <Flex vertical gap={12} style={{ height: "100%" }}>
        <Typography.Text type="secondary" style={{ fontSize: 14 }}>
          <Flex justify="space-between" align="center">
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
        {valueRow}
        {meter != null ? (
          <Progress
            percent={Math.min(meter, 1) * 100}
            showInfo={false}
            size={{ height: 6 }}
            strokeColor={
              isMeterExceeded(meter)
                ? token.colorError
                : isMeterWarning(meter)
                  ? token.colorWarning
                  : undefined
            }
            style={{ margin: 0, lineHeight: 1 }}
          />
        ) : null}
        {hint != null ? (
          <Typography.Text type={effectiveHintType} style={{ fontSize: 13 }}>
            {hint}
          </Typography.Text>
        ) : null}
        {children}
        {/* Pushed to the bottom so buttons line up across cards of different content height. */}
        {footerAction != null ? <div style={{ marginTop: "auto" }}>{footerAction}</div> : null}
      </Flex>
    </Card>
  );
}

// Secondary text after a stat value, e.g. the "/ 5" in "4 / 5".
export function StatSuffix({ children }: { children: React.ReactNode }) {
  return (
    <Typography.Text type="secondary" style={{ fontSize: 14, fontWeight: 400 }}>
      {" "}
      {children}
    </Typography.Text>
  );
}
