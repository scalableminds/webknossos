import { Popover } from "antd";
import type * as React from "react";

import classNames from "classnames";
import { document } from "libs/window";
import { NODE_ID_REF_REGEX, POSITION_REF_REGEX } from "viewer/constants";
import { setActiveNodeAction } from "viewer/model/actions/skeletontracing_actions";
import type { CommentType } from "viewer/model/types/tree_types";
import Store from "viewer/store";
import { MarkdownWrapper } from "viewer/view/components/markdown_modal";

function linkify(comment: string) {
  return comment // Replace linked nodes (#<nodeid>) with a proper link
    .replace(NODE_ID_REF_REGEX, (__, p1) => `[#${p1}](#activeNode=${p1})`) // Replace linked positions (#(<x,y,z>)) with a proper link
    .replace(POSITION_REF_REGEX, (__, p1) => `[#(${p1})](#position=${p1})`);
}

type CommentProps = {
  isActive: boolean;
  comment: CommentType;
};
export const commentListId = "commentList";

function ActiveCommentPopover({
  comment,
  children,
  isActive,
}: {
  comment: CommentType;
  children: React.ReactNode;
  isActive: boolean;
}) {
  if (!isActive) {
    return <>{children}</>;
  }

  return (
    <Popover
      content={<MarkdownWrapper source={linkify(comment.content)} />}
      defaultOpen
      open
      autoAdjustOverflow={false}
      placement="rightTop"
      // @ts-expect-error ts-migrate(2322) FIXME: Type '() => HTMLElement | null' is not assignable ... Remove this comment to see the full error message
      getPopupContainer={() => document.getElementById(commentListId)}
      style={{
        maxHeight: 200,
        overflowY: "auto",
      }}
    >
      {children}
    </Popover>
  );
}

export function Comment({ comment, isActive }: CommentProps) {
  const handleClick = () => {
    Store.dispatch(setActiveNodeAction(comment.nodeId));
  };

  const liClassName = classNames("markdown", "markdown-small", "nowrap");

  const isMultiLine = comment.content.indexOf("\n") !== -1;

  return (
    <div className={liClassName}>
      <span>
        <a onClick={handleClick}>{comment.nodeId}</a>
        {" - "}
      </span>
      <span
        style={{
          display: "inline-block",
        }}
      >
        <MarkdownWrapper source={linkify(comment.content)} singleLine />
      </span>
      {isMultiLine ? (
        <ActiveCommentPopover comment={comment} isActive={isActive}>
          <span
            style={{
              marginLeft: 5,
            }}
          >
            <a onClick={handleClick}>
              <i className="far fa-comment-dots" />
            </a>
          </span>
        </ActiveCommentPopover>
      ) : null}
    </div>
  );
}
export default Comment;
