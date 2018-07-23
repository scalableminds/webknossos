// @flow
import * as React from "react";
import _ from "lodash";
import { Popover } from "antd";
import classNames from "classnames";
import Store from "oxalis/store";
import { setActiveNodeAction } from "oxalis/model/actions/skeletontracing_actions";
import Markdown from "react-remarkable";
import { NODE_ID_REF_REGEX, POSITION_REF_REGEX } from "oxalis/constants";
import type { CommentType } from "oxalis/store";

function linkify(comment: string) {
  return (
    comment
      // Replace linked nodes (#<nodeid>) with a proper link
      .replace(NODE_ID_REF_REGEX, (match, p1) => `[#${p1}](#activeNode=${p1})`)
      // Replace linked positions (#(<x,y,z>)) with a proper link
      .replace(POSITION_REF_REGEX, (match, p1) => `[#(${p1})](#position=${p1})`)
  );
}

type CommentProps = {
  isActive: boolean,
  comment: CommentType,
  style: Object,
};

export function MarkdownComment({ comment }: { comment: CommentType }) {
  return (
    <Markdown
      source={linkify(comment.content)}
      options={{ html: false, breaks: true, linkify: true }}
    />
  );
}

export function Comment({ comment, isActive, style }: CommentProps) {
  const handleClick = () => {
    Store.dispatch(setActiveNodeAction(comment.nodeId));
  };

  const liClassName = classNames("markdown", "markdown-small", {
    bold: isActive,
  });
  const iClassName = classNames("fa", "fa-fw", {
    "fa-angle-right": isActive,
  });
  const isMultiLine = comment.content.indexOf("\n") > 0;

  const commentElement = (
    <li className={liClassName} style={_.extend({}, style, { width: "inherit" })}>
      <span className="comment-node-id">
        <i className={iClassName} />
        <a onClick={handleClick}>{comment.nodeId}</a>
        {" - "}
      </span>
      <span style={{ display: "inline-block" }}>{<MarkdownComment comment={comment} />}</span>
      {isMultiLine ? <span className="comment-node-id"> ...</span> : null}
    </li>
  );

  return isActive && isMultiLine ? (
    <Popover
      content={<MarkdownComment comment={comment} />}
      defaultVisible
      visible
      placement="right"
      getPopupContainer={() => document.getElementById("comment-list")}
      style={{ maxHeight: 200, overflowY: "auto" }}
    >
      {commentElement}
    </Popover>
  ) : (
    commentElement
  );
}

export default Comment;
