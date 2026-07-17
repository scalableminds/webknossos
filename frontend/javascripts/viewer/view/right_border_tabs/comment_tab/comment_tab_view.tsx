import { Divider } from "antd";
import { useWkSelector } from "libs/react_hooks";
import React, { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { setActiveNodeAction } from "viewer/model/actions/skeletontracing_actions";
import type { CommentType } from "viewer/model/types/tree_types";
import DomVisibilityObserver from "viewer/view/components/dom_visibility_observer";
import { CommentEditor } from "./comment_editor";
import { CommentTabToolbar } from "./comment_tab_toolbar";
import { CommentTreeView } from "./comment_tree_view";
import { useCommentKeyboardShortcuts, useCommentNavigation } from "./hooks/use_comment_navigation";
import { useCommentSorting } from "./hooks/use_comment_sorting";
import { useCommentTabData } from "./hooks/use_comment_tab_data";
import { useExpandedTreeKeys } from "./hooks/use_expanded_tree_keys";

const commentTabId = "commentTabId";

function CommentTab() {
  const dispatch = useDispatch();

  const { sorting, setSortMode, toggleSortDirection } = useCommentSorting();
  const { treeNodes, sortedComments } = useCommentTabData(sorting);
  const { expandedKeys, setExpandedKeys, expandTree, toggleExpandAll } =
    useExpandedTreeKeys(treeNodes);
  const { nextComment, previousComment } = useCommentNavigation(sortedComments);
  useCommentKeyboardShortcuts(nextComment, previousComment);

  const activeTreeId = useWkSelector(
    (state) => getSkeletonTracing(state.annotation)?.activeTreeId ?? null,
  );
  const [isMarkdownModalOpen, setIsMarkdownModalOpen] = useState(false);

  // When a comment is created, make sure its tree is expanded so the comment is visible.
  const expandActiveTree = useCallback(() => {
    if (activeTreeId != null) {
      expandTree(activeTreeId);
    }
  }, [activeTreeId, expandTree]);

  const selectComment = useCallback(
    (comment: CommentType) => {
      dispatch(setActiveNodeAction(comment.nodeId));
      const parentTreeNode = treeNodes.find((treeNode) =>
        treeNode.children.some((child) => child.comment.nodeId === comment.nodeId),
      );
      if (parentTreeNode != null) {
        expandTree(parentTreeNode.tree.treeId);
      }
    },
    [dispatch, treeNodes, expandTree],
  );

  return (
    <div id={commentTabId} className="flex-column padded-tab-content" style={{ height: "inherit" }}>
      <DomVisibilityObserver targetId={commentTabId}>
        {(isVisibleInDom) => {
          // Skip rendering entirely while the tab is hidden, except when the
          // markdown modal is open (it would disappear otherwise).
          if (!isVisibleInDom && !isMarkdownModalOpen) {
            return null;
          }

          return (
            <React.Fragment>
              <CommentTabToolbar
                targetId={commentTabId}
                sorting={sorting}
                sortedComments={sortedComments}
                editor={
                  <CommentEditor
                    isMarkdownModalOpen={isMarkdownModalOpen}
                    onOpenMarkdownModal={() => setIsMarkdownModalOpen(true)}
                    onCloseMarkdownModal={() => setIsMarkdownModalOpen(false)}
                    onCommentCreated={expandActiveTree}
                  />
                }
                onChangeSortMode={setSortMode}
                onToggleSortDirection={toggleSortDirection}
                onPreviousComment={previousComment}
                onNextComment={nextComment}
                onToggleExpandAll={toggleExpandAll}
                onSelectComment={selectComment}
              />
              <Divider size="small" />
              <div style={{ flex: "1 1 auto" }}>
                <CommentTreeView
                  treeNodes={treeNodes}
                  expandedKeys={expandedKeys}
                  onExpand={setExpandedKeys}
                />
              </div>
            </React.Fragment>
          );
        }}
      </DomVisibilityObserver>
    </div>
  );
}

function CommentTabView() {
  // Safe-guard: only render the tab when a skeleton tracing exists.
  const hasSkeletonTracing = useWkSelector((state) => getSkeletonTracing(state.annotation) != null);

  return hasSkeletonTracing ? <CommentTab /> : null;
}

export default CommentTabView;
