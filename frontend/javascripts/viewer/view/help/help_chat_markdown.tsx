import Markdown from "libs/markdown_adapter";
import type { ReactNode } from "react";

const CHAT_MARKDOWN_COMPONENTS = {
  h1: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", fontSize: 15, margin: "14px 0" }}>{children}</strong>
  ),
  h2: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", fontSize: 14, margin: "10px 0" }}>{children}</strong>
  ),
  h3: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", margin: "8px 0" }}>{children}</strong>
  ),
  h4: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", margin: "6px 0" }}>{children}</strong>
  ),
  h5: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", margin: "4px 0" }}>{children}</strong>
  ),
  h6: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", margin: "2px 0" }}>{children}</strong>
  ),
  hr: () => <hr style={{ margin: "10px 0" }} />,
  ul: ({ children }: { children: ReactNode }) => <ul style={{ paddingLeft: 16 }}>{children}</ul>,
  ol: ({ children }: { children: ReactNode }) => <ol style={{ paddingLeft: 16 }}>{children}</ol>,
};

export function HelpChatMarkdown({ text }: { text: string }) {
  return <Markdown components={CHAT_MARKDOWN_COMPONENTS}>{text}</Markdown>;
}
