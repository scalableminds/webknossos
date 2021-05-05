// @flow
import * as React from "react";
import classNames from "classnames";

import type { Tree } from "oxalis/store";

type Props = {
  tree: Tree,
  collapsed: boolean,
  style: Object,
  onExpand: number => void,
  isActive: boolean,
};

function TreeWithComments(props: Props) {
  const handleToggleComment = () => {
    props.onExpand(props.tree.treeId);
  };

  const liClassName = classNames("nowrap", { "comment-active": props.isActive });
  const iClassName = classNames("fa", "fa-fw", {
    "fa-chevron-right": props.collapsed,
    "fa-chevron-down": !props.collapsed,
  });
  const { width, ...liStyle } = props.style;

  return (
    <li style={liStyle} className={liClassName}>
      <a onClick={handleToggleComment}>
        <i className={iClassName} />
      </a>
      {props.tree.treeId} - {props.tree.name}
    </li>
  );
}

export default TreeWithComments;
