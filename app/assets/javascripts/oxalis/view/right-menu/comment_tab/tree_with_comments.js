// @flow
import * as React from "react";
import _ from "lodash";
import classNames from "classnames";
import type { TreeType } from "oxalis/store";

type Props = {
  tree: TreeType,
  collapsed: boolean,
  style: Object,
  onExpand: number => void,
  isActive: boolean,
};

function TreeWithComments(props: Props) {
  const handleToggleComment = () => {
    props.onExpand(props.tree.treeId);
  };

  const liClassName = classNames({ bold: props.isActive });
  const iClassName = classNames("fa", "fa-fw", {
    "fa-chevron-right": props.collapsed,
    "fa-chevron-down": !props.collapsed,
  });

  return (
    <li style={_.extend({}, props.style, { width: "inherit" })} className={liClassName}>
      <a onClick={handleToggleComment}>
        <i className={iClassName} />
      </a>
      {props.tree.treeId} - {props.tree.name}
    </li>
  );
}

export default TreeWithComments;
