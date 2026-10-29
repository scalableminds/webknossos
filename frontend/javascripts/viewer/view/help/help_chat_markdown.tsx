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
};

export function HelpChatMarkdown({ text }: { text: string }) {
  // The Typography container styles the lists, inline code, keys and code blocks of the reply.
  return (
    <Typography>
      <Markdown components={CHAT_MARKDOWN_COMPONENTS}>{text}</Markdown>
    </Typography>
  );
}
