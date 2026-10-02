import { Collapse, ConfigProvider, Flex, Space, Typography, theme } from "antd";
import type React from "react";

type AiJobLayoutProps = {
  description: string;
  sidebar: React.ReactNode;
  children: React.ReactNode;
};

/** Shared layout of an AI job tab: lead text, the job's sections and the sticky credit sidebar. */
export function AiJobLayout({ description, sidebar, children }: AiJobLayoutProps) {
  const { cssVar } = theme.useToken();
  return (
    <>
      <Typography.Paragraph
        style={{ color: cssVar.colorTextSecondary, maxWidth: 760, marginBottom: 16 }}
      >
        {description}
      </Typography.Paragraph>
      <Flex gap="large" align="flex-start">
        <Flex flex="2" vertical gap="middle" style={{ minWidth: 0 }}>
          {children}
        </Flex>
        <Flex flex="1" vertical style={{ position: "sticky", top: 0 }}>
          {sidebar}
        </Flex>
      </Flex>
    </>
  );
}

type AdvancedSettingsProps = {
  hint?: string;
  children: React.ReactNode;
};

/** Collapsed-by-default advanced settings at the bottom of a job section. */
export function AdvancedSettings({ hint, children }: AdvancedSettingsProps) {
  const { cssVar } = theme.useToken();
  return (
    <ConfigProvider
      theme={{ components: { Collapse: { headerPadding: "0px", contentPadding: "16px 0 0" } } }}
    >
      <Collapse
        ghost
        style={{ borderTop: `1px solid ${cssVar.colorBorderSecondary}`, paddingTop: 12 }}
        items={[
          {
            key: "advanced",
            label: (
              <Space size="small">
                Advanced settings
                {hint && <Typography.Text type="secondary">{hint}</Typography.Text>}
              </Space>
            ),
            children,
          },
        ]}
      />
    </ConfigProvider>
  );
}
