import { Typography } from "antd";
import Markdown from "libs/markdown_adapter";
import type { ReactNode } from "react";

const CHAT_MARKDOWN_COMPONENTS = {
  h1: ({ children }: { children: ReactNode }) => (
    <Typography.Title level={1} style={{ fontSize: 15, margin: "16px 0" }}>
      {children}
    </Typography.Title>
  ),
  h2: ({ children }: { children: ReactNode }) => (
    <Typography.Title level={2} style={{ fontSize: 14, margin: "12px 0" }}>
      {children}
    </Typography.Title>
  ),
  h3: ({ children }: { children: ReactNode }) => (
    <Typography.Title level={3} style={{ fontSize: 13, margin: "8px 0" }}>
      {children}
    </Typography.Title>
  ),
  h4: ({ children }: { children: ReactNode }) => (
    <Typography.Title level={4} style={{ fontSize: 13, margin: "6px 0" }}>
      {children}
    </Typography.Title>
  ),
  h5: ({ children }: { children: ReactNode }) => (
    <Typography.Title level={5} style={{ fontSize: 13, margin: "4px 0" }}>
      {children}
    </Typography.Title>
  ),
  hr: () => <hr style={{ margin: "10px 0" }} />,
  ul: ({ children }: { children: ReactNode }) => <ul style={{ paddingLeft: 16 }}>{children}</ul>,
  ol: ({ children }: { children: ReactNode }) => <ol style={{ paddingLeft: 16 }}>{children}</ol>,
};

export function HelpChatMarkdown({ text }: { text: string }) {
  return <Markdown components={CHAT_MARKDOWN_COMPONENTS}>{text}</Markdown>;
}
