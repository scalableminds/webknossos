// @flow
import * as React from "react";
import _ from "lodash";
import classNames from "classnames";
import Store from "oxalis/store";
import { setActiveNodeAction } from "oxalis/model/actions/skeletontracing_actions";
import Markdown from "react-remarkable";
import type { CommentType } from "oxalis/store";

function linkify(comment: string) {
  return (
    comment
      // Replace linkes nodes (#<nodeid>) with a proper link
      // (?!...) is a negative lookahead to ignore linked positions (#<x,y,z>)
      .replace(
        /#(?![0-9.]+,[0-9.]+,[0-9.]+)([0-9.]+)/g,
        (match, p1) => `[#${p1}](#activeNode=${p1})`,
      )
      // Replace linked positions (#<x,y,z>) with a proper link
      .replace(/#([0-9.]+,[0-9.]+,[0-9.]+)/g, (match, p1) => `[#${p1}](#position=${p1})`)
  );
}

type CommentProps = {
  isActive: boolean,
  comment: CommentType,
  style: Object,
};

function Comment({ comment, isActive, style }: CommentProps) {
  const handleClick = () => {
    Store.dispatch(setActiveNodeAction(comment.nodeId));
  };

  const liClassName = classNames("markdown", {
    bold: isActive,
    "markdown-small": !isActive,
  });
  const iClassName = classNames("fa", "fa-fw", {
    "fa-angle-right": isActive,
  });

  return (
    <li className={liClassName} style={_.extend({}, style, { width: "inherit" })}>
      <i className={iClassName} />
      <a onClick={handleClick}>{comment.nodeId}</a>
      {" - "}
      <div style={{ display: "inline-block" }}>
        <Markdown
          source={linkify(comment.content)}
          options={{ html: false, breaks: true, linkify: true }}
        />
      </div>
    </li>
  );
}

export default Comment;
