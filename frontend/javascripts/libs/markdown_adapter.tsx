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

const Markdown = loadable<Props>(() => import("react-markdown") as Promise<any>);

export default Markdown as React.FC<{ children: React.ReactNode; className?: string }>;

export const MarkdownWithExternalLinks = ({ children, className }: Props) => {
  return (
    <Markdown components={{ a: LinkRenderer }} className={className}>
      {children}
    </Markdown>
  );
};
