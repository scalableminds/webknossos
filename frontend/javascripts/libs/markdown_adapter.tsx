import type * as React from "react";
import loadable from "./lazy_loader";

type Props = {
  children?: React.ReactNode;
  className?: string;
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

const ReactMarkdown = loadable<Props>(() => import("react-markdown") as Promise<any>);

export default function Markdown({ children, className }: Props) {
  return (
    <ReactMarkdown components={{ a: LinkRenderer }} className={className}>
      {children}
    </ReactMarkdown>
  );
}
