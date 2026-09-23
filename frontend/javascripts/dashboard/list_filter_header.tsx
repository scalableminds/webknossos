import { DownOutlined } from "@ant-design/icons";
import { Button, Dropdown, Flex, Space, Typography, theme } from "antd";
import type React from "react";

export function ListFilterHeader({
  summary,
  children,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Flex
      justify="space-between"
      align="center"
      wrap="wrap"
      gap="small"
      className="dashboard-list-filter-bar"
    >
      <Typography.Text type="secondary">{summary}</Typography.Text>
      <Space size="small" wrap>
        {children}
      </Space>
    </Flex>
  );
}

export function FilterChip({
  label,
  active,
  children,
}: {
  label: React.ReactNode;
  active?: boolean;
  children: React.ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <Dropdown
      trigger={["click"]}
      popupRender={() => (
        <div
          style={{
            background: token.colorBgElevated,
            boxShadow: token.boxShadowSecondary,
            borderRadius: token.borderRadiusLG,
            padding: 12,
            minWidth: 200,
          }}
        >
          {children}
        </div>
      )}
    >
      <Button type={active ? "default" : "text"} icon={<DownOutlined />} iconPlacement="end">
        {label}
      </Button>
    </Dropdown>
  );
}

// Renders a muted, single-line row of meta info (e.g. size · annotation count · created date),
// separating the (non-null) entries with a dot, similar to the dashboard mockup.
export function RowMetaLine({ items }: { items: React.ReactNode[] }) {
  const visibleItems = items.filter((item) => item != null);
  return (
    <div className="dashboard-row-meta">
      {visibleItems.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: items are a stable, ordered list for a given row
        <span className="dashboard-row-meta-item" key={index}>
          {index > 0 ? <span className="dashboard-row-meta-dot">·</span> : null}
          {item}
        </span>
      ))}
    </div>
  );
}
