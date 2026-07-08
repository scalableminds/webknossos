import { EditOutlined } from "@ant-design/icons";
import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import ButtonComponent from "viewer/view/components/button_component";
import InputComponent from "viewer/view/components/input_component";
import { MarkdownModal } from "viewer/view/components/markdown_modal";
import { useActiveComment } from "./hooks/use_active_comment";
import { useCommentEditPermission } from "./hooks/use_comment_edit_permission";
import { useCommentMutations } from "./hooks/use_comment_mutations";

// A single-line <input> cannot display real line breaks, so they are shown as the
// literal character sequence "\n" and converted back when saving.
const encodeLineBreaks = (content: string) => content.replace(/\r?\n/g, "\\n");
const decodeLineBreaks = (inputValue: string) => inputValue.replace(/\\n/g, "\n");

type CommentEditorProps = {
  isMarkdownModalOpen: boolean;
  onOpenMarkdownModal: () => void;
  onCloseMarkdownModal: () => void;
  // Called after a non-empty comment is saved, so the parent can reveal it (e.g. expand its tree).
  onCommentCreated: () => void;
};

/*
 * Edits the comment of the currently active node: a single-line input for quick
 * edits plus a button that opens a markdown modal for multi-line editing. Owns
 * all editing state and logic; the parent only holds the modal-open flag because
 * its visibility guard depends on it.
 */
export function CommentEditor({
  isMarkdownModalOpen,
  onOpenMarkdownModal,
  onCloseMarkdownModal,
  onCommentCreated,
}: CommentEditorProps) {
  const activeComment = useActiveComment();
  const activeNodeId = useWkSelector(
    (state) => getSkeletonTracing(state.annotation)?.activeNodeId ?? null,
  );
  const { isDisabled, disabledReason } = useCommentEditPermission();
  const { saveComment } = useCommentMutations();

  const isMultiline = activeComment?.content.includes("\n") ?? false;
  const inputValue = activeComment != null ? encodeLineBreaks(activeComment.content) : "";

  const handleSave = (content: string) => {
    saveComment(content);
    if (content !== "") {
      onCommentCreated();
    }
  };

  return (
    <>
      <InputComponent
        value={inputValue}
        disabled={isDisabled}
        title={disabledReason ?? undefined}
        onChange={(evt: React.ChangeEvent<HTMLInputElement>) =>
          handleSave(decodeLineBreaks(evt.target.value))
        }
        onPressEnter={(evt: React.KeyboardEvent<HTMLInputElement>) =>
          (evt.target as HTMLElement).blur()
        }
        placeholder="Add comment"
      />
      <ButtonComponent
        onClick={onOpenMarkdownModal}
        disabled={isDisabled}
        title={disabledReason ?? "Open dialog to edit comment in multi-line mode"}
        type={isMultiline ? "primary" : "default"}
        icon={<EditOutlined />}
        variant="text"
        color="default"
      />
      {/* isDisabled is already true when there is no active node, so it fully gates the modal. */}
      {!isDisabled && activeNodeId != null ? (
        <MarkdownModal
          key={activeNodeId}
          source={activeComment?.content ?? ""}
          isOpen={isMarkdownModalOpen}
          onChange={handleSave}
          onOk={onCloseMarkdownModal}
          label="Comment"
        />
      ) : null}
    </>
  );
}
