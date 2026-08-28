import { CommentOutlined } from "@ant-design/icons";
import { Popover } from "antd";
import classNames from "classnames";
import { document } from "libs/window";
import type React from "react";
import { memo, useCallback } from "react";
import { useDispatch } from "react-redux";
import { NODE_ID_REF_REGEX, POSITION_REF_REGEX } from "viewer/constants";
import { setActiveNodeAction } from "viewer/model/actions/skeletontracing_actions";
import type { CommentType } from "viewer/model/types/tree_types";
import { MarkdownWrapper } from "viewer/view/components/markdown_modal";

// The comment list container element. The popover for multi-line comments is
// mounted into it so that it moves together with the tab content.
export const commentListId = "commentList";

// Turns #<nodeId> and #(<x>,<y>,<z>) references into markdown links which are
// handled by the application's URL hash handling.
function linkifyReferences(content: string): string {
  return content
    .replace(NODE_ID_REF_REGEX, (_match, nodeId) => `[#${nodeId}](#activeNode=${nodeId})`)
    .replace(POSITION_REF_REGEX, (_match, position) => `[#(${position})](#position=${position})`);
}

function MultilineCommentPopover({
  comment,
  isActive,
  children,
}: {
  comment: CommentType;
  isActive: boolean;
  children: React.ReactNode;
}) {
  if (!isActive) {
    return <>{children}</>;
  }

  return (
    <Popover
      content={<MarkdownWrapper source={linkifyReferences(comment.content)} />}
      defaultOpen
      open
      autoAdjustOverflow={false}
      placement="rightTop"
      getPopupContainer={() => document.getElementById(commentListId) ?? document.body}
      style={{
        maxHeight: 200,
        overflowY: "auto",
      }}
    >
      {children}
    </Popover>
  );
}

type CommentProps = {
  comment: CommentType;
  isActive: boolean;
};

const Comment = memo(function Comment({ comment, isActive }: CommentProps) {
  const dispatch = useDispatch();

  const activateNode = useCallback(() => {
    dispatch(setActiveNodeAction(comment.nodeId));
  }, [comment.nodeId, dispatch]);

  const isMultiline = comment.content.includes("\n");

  return (
    <div className={classNames("markdown", "markdown-small", "nowrap")}>
      <span>
        <a onClick={activateNode}>{comment.nodeId}</a>
        {" - "}
      </span>
      <span style={{ display: "inline-block" }}>
        <MarkdownWrapper source={linkifyReferences(comment.content)} singleLine />
      </span>
      {isMultiline ? (
        <MultilineCommentPopover comment={comment} isActive={isActive}>
          <span style={{ marginLeft: 5 }}>
            <a onClick={activateNode}>
              <CommentOutlined />
            </a>
          </span>
        </MultilineCommentPopover>
      ) : null}
    </div>
  );
});

export default Comment;
