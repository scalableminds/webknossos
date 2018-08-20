// @flow
import * as React from "react";
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
      .replace(NODE_ID_REF_REGEX, (__, p1) => `[#${p1}](#activeNode=${p1})`)
      // Replace linked positions (#(<x,y,z>)) with a proper link
      .replace(POSITION_REF_REGEX, (__, p1) => `[#(${p1})](#position=${p1})`)
  );
}

function getFirstLine(comment: string) {
  const newLineIndex = comment.indexOf("\n");
  return comment.slice(0, newLineIndex !== -1 ? newLineIndex : undefined);
}

type CommentProps = {
  isActive: boolean,
  comment: CommentType,
  style: Object,
};

export function MarkdownComment({
  comment,
  singleLine,
}: {
  comment: CommentType,
  singleLine?: boolean,
}) {
  const content = singleLine ? getFirstLine(comment.content) : comment.content;
  return (
    <Markdown source={linkify(content)} options={{ html: false, breaks: true, linkify: true }} />
  );
}

function ActiveCommentPopover({
  comment,
  children,
  isActive,
}: {
  comment: CommentType,
  children: React.Node,
  isActive: boolean,
}) {
  return isActive ? (
    <Popover
      content={<MarkdownComment comment={comment} />}
      defaultVisible
      visible
      autoAdjustOverflow={false}
      placement="rightTop"
      getPopupContainer={() => document.getElementById("comment-list")}
      style={{ maxHeight: 200, overflowY: "auto" }}
    >
      {children}
    </Popover>
  ) : (
    children
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
  const isMultiLine = comment.content.indexOf("\n") !== -1;

  return (
    <li className={liClassName} style={style}>
      <span>
        <i className={iClassName} />
        <a onClick={handleClick}>{comment.nodeId}</a>
        {" - "}
      </span>
      <span style={{ display: "inline-block" }}>
        <MarkdownComment comment={comment} singleLine />
      </span>
      {isMultiLine ? (
        <ActiveCommentPopover comment={comment} isActive={isActive}>
          <span style={{ marginLeft: 5 }}>
            <a onClick={handleClick}>
              <i className="fa fa-commenting-o" />
            </a>
          </span>
        </ActiveCommentPopover>
      ) : null}
    </li>
  );
}

export default Comment;
