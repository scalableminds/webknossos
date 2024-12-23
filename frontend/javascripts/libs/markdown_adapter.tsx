import type * as React from "react";
import loadable from "./lazy_loader";

type Props = {
  children?: React.ReactNode;
  className?: string;
};

const Markdown = loadable<Props>(() => import("react-markdown") as Promise<any>);

export default Markdown as React.FC<{ children: React.ReactNode; className?: string }>;
