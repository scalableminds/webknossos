import { Typography } from "antd";
import type * as React from "react";
import loadable from "./lazy_loader";

type Props = {
  children?: React.ReactNode;
  components?: Record<string, any>;
};

function LinkRenderer(props: { children: React.ReactNode; href: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(ev) => {
        ev.stopPropagation();
      }}
    >
      {props.children}
    </a>
  );
}

// Markdown headings are rendered as <Typography.Title> so that they pick up the
// WEBKNOSSOS heading sizes from the design tokens (see theme.ts). `marginTop: 0`
// mirrors what raw heading tags got from antd's reset and suppresses the extra top
// margin antd adds between two adjacent Typography elements.
const HEADING_LEVELS = [1, 2, 3, 4, 5] as const;

const MARKDOWN_HEADING_COMPONENTS = Object.fromEntries(
  HEADING_LEVELS.map((level) => [
    `h${level}`,
    ({ children }: { children: React.ReactNode }) => (
      <Typography.Title level={level} style={{ marginTop: 0 }}>
        {children}
      </Typography.Title>
    ),
  ]),
);

const ReactMarkdown = loadable<Props>(
  () => import("react-markdown") as Promise<any>,
  // If react-markdown cannot be loaded, fall back to rendering the raw markdown text
  // as this is less intrusive than rendering an error message.
  ({ children }) => <>{children}</>,
);

export default function Markdown({ children, components }: Props) {
  return (
    <ReactMarkdown components={{ ...MARKDOWN_HEADING_COMPONENTS, ...components, a: LinkRenderer }}>
      {children}
    </ReactMarkdown>
  );
}
