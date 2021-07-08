// @flow
import { Popover } from "antd";
import * as React from "react";
import classNames from "classnames";

import { MarkdownWrapper } from "oxalis/view/components/markdown_modal";
import { NODE_ID_REF_REGEX, POSITION_REF_REGEX } from "oxalis/constants";
import { document } from "libs/window";
import { setActiveNodeAction } from "oxalis/model/actions/skeletontracing_actions";
import Store, { type CommentType } from "oxalis/store";

function linkify(comment: string) {
  return (
    comment
      // Replace linked nodes (#<nodeid>) with a proper link
      .replace(NODE_ID_REF_REGEX, (__, p1) => `[#${p1}](#activeNode=${p1})`)
      // Replace linked positions (#(<x,y,z>)) with a proper link
      .replace(POSITION_REF_REGEX, (__, p1) => `[#(${p1})](#position=${p1})`)
  );
}

type CommentProps = {
  isActive: boolean,
  comment: CommentType,
  style: Object,
};

export const commentListId = "commentList";

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
      content={<MarkdownWrapper source={linkify(comment.content)} />}
      defaultVisible
      visible
      autoAdjustOverflow={false}
      placement="rightTop"
      getPopupContainer={() => document.getElementById(commentListId)}
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

  const liClassName = classNames("markdown", "markdown-small", "nowrap", "comment", {
    "comment-active": isActive,
  });
  const iClassName = classNames("fa", "fa-fw", {
    "fa-angle-right": isActive,
  });
  const isMultiLine = comment.content.indexOf("\n") !== -1;

  return (
    <li style={style}>
      <div className={liClassName}>
        <span>
          <i className={iClassName} />
          <a onClick={handleClick}>{comment.nodeId}</a>
          {" - "}
        </span>
        <span style={{ display: "inline-block" }}>
          <MarkdownWrapper source={linkify(comment.content)} singleLine />
        </span>
        {isMultiLine ? (
          <ActiveCommentPopover comment={comment} isActive={isActive}>
            <span style={{ marginLeft: 5 }}>
              <a onClick={handleClick}>
                <i className="far fa-comment-dots" />
              </a>
            </span>
          </ActiveCommentPopover>
        ) : null}
      </div>
    </li>
  );
}

export default Comment;
