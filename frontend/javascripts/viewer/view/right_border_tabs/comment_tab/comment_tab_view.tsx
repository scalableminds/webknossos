import { Divider } from "antd";
import type { EventDataNode } from "antd/es/tree";
import { useEffectOnlyOnce, useWkSelector } from "libs/react_hooks";
import isEmpty from "lodash-es/isEmpty";
import uniq from "lodash-es/uniq";
import messages from "messages";
import React, { useState } from "react";
import { useDispatch } from "react-redux";
import { isAnnotationOwner, mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { getActiveNode, getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  createCommentAction,
  deleteCommentAction,
  setActiveNodeAction,
} from "viewer/model/actions/skeletontracing_actions";
import { cachedDiffTrees } from "viewer/model/sagas/skeletontracing_saga";
import type { CommentType, MutableCommentType } from "viewer/model/types/tree_types";
import type { SkeletonTracing } from "viewer/store";
import DomVisibilityObserver from "viewer/view/components/dom_visibility_observer";
import { MarkdownModal } from "viewer/view/components/markdown_modal";
import { SortByEnum } from "viewer/view/right_border_tabs/comment_tab/comment_sorting";
import CommentTabToolbar from "viewer/view/right_border_tabs/comment_tab/comment_tab_toolbar";
import CommentTree from "viewer/view/right_border_tabs/comment_tab/comment_tree";
import { useCommentData } from "viewer/view/right_border_tabs/comment_tab/hooks/use_comment_data";
import { useCommentNavigation } from "viewer/view/right_border_tabs/comment_tab/hooks/use_comment_navigation";
import { useScrollToComment } from "viewer/view/right_border_tabs/comment_tab/hooks/use_scroll_to_comment";

const commentTabId = "commentTabId";

const RELEVANT_ACTIONS_FOR_COMMENTS = [
  "updateTree",
  "deleteTree",
  "mergeTree",
  "moveTreeComponent",
  "deleteEdge",
  "revertToVersion",
];

type Props = {
  skeletonTracing: SkeletonTracing;
};

function CommentTabView({ skeletonTracing }: Props) {
  const [isSortedAscending, setIsSortedAscending] = useState(true);
  const [sortBy, setSortBy] = useState(SortByEnum.NAME);
  const [expandedTreeIds, setExpandedTreeIds] = useState<React.Key[]>([]);
  const [isMarkdownModalOpen, setIsMarkdownModalOpen] = useState(false);
  const [isVisibleInDom, setIsVisibleInDom] = useState(true);

  const dispatch = useDispatch();

  const keyboardShortcutsConfig = useWkSelector(
    (state) => state.keyboardConfiguration.shortcutsConfig,
  );
  const allowUpdate = useWkSelector(mayEditAnnotation);
  const isAnnotationLockedByUser = useWkSelector((state) => state.annotation.isLockedByOwner);
  const isOwner = useWkSelector((state) => isAnnotationOwner(state));

  const { sortedTrees, flatComments } = useCommentData(
    skeletonTracing.trees,
    sortBy,
    isSortedAscending,
  );

  const activeComment = getActiveComment();

  const { goToNextComment, goToPreviousComment } = useCommentNavigation(
    { skeletonTracing, sortBy, isSortedAscending },
    keyboardShortcutsConfig,
  );

  const { treeRef, highlightedNodeIds } = useScrollToComment(
    activeComment,
    skeletonTracing.activeTreeId,
    isVisibleInDom,
  );

  useEffectOnlyOnce(() => {
    // expand all trees by default
    setExpandedTreeIds(sortedTrees.map((tree) => tree.treeId.toString()));
  });

  function setActiveNode(nodeId: number) {
    dispatch(setActiveNodeAction(nodeId));
  }

  function handleChangeInput(commentText: string, insertLineBreaks: boolean = false) {
    if (commentText) {
      dispatch(
        createCommentAction(insertLineBreaks ? commentText.replace(/\\n/g, "\n") : commentText),
      );

      // make sure that the skeleton tree node is expanded
      if (skeletonTracing.activeTreeId)
        setExpandedTreeIds([...expandedTreeIds, skeletonTracing.activeTreeId.toString()]);
    } else {
      dispatch(deleteCommentAction());
    }
  }

  function handleChangeSorting({ key }: { key: any }) {
    setSortBy(key as SortByEnum);
  }

  function toggleSortingDirection() {
    setIsSortedAscending((prevState) => !prevState);
  }

  function toggleExpandAllTrees() {
    setExpandedTreeIds((prevState) => {
      const shouldBeCollapsed = !isEmpty(prevState);
      return shouldBeCollapsed ? [] : sortedTrees.map((tree) => tree.treeId.toString());
    });
  }

  function onSelect(
    _selectedKeys: React.Key[],
    { node }: { node: EventDataNode<MutableCommentType> },
  ) {
    // Careful, this method is invoked both when clicking on a skeleton tree ("root-node") or a comment ("child node")
    if ("nodeId" in node) {
      setActiveNode(node.nodeId);
    }
  }

  function onSearchSelect(comment: CommentType) {
    setActiveNode(comment.nodeId);

    const tree = sortedTrees.find((tree) => tree.nodes.has(comment.nodeId));
    if (tree) {
      setExpandedTreeIds(uniq([...expandedTreeIds, tree.treeId.toString()]));
    }
  }

  function getActiveComment(): MutableCommentType | undefined {
    const { activeTreeId, activeNodeId } = skeletonTracing;

    if (activeTreeId && activeNodeId) {
      return skeletonTracing.trees
        .getOrThrow(activeTreeId)
        .comments.find((comment) => comment.nodeId === activeNodeId);
    }
    return undefined;
  }

  function renderMarkdownModal() {
    if (!allowUpdate || !skeletonTracing.activeNodeId) {
      return null;
    }

    const comment = activeComment ?? { nodeId: skeletonTracing.activeNodeId, content: "" };

    return (
      <MarkdownModal
        key={comment.nodeId}
        source={comment.content}
        isOpen={isMarkdownModalOpen}
        onChange={handleChangeInput}
        onOk={() => setIsMarkdownModalOpen(false)}
        label="Comment"
      />
    );
  }

  // Replace line breaks as they will otherwise be stripped when shown in an input field
  const activeCommentContent = activeComment?.content.replace(/\r?\n/g, "\\n");
  const isMultilineComment = activeCommentContent?.indexOf("\\n") !== -1;
  const activeNode = getActiveNode(skeletonTracing);
  const isEditingDisabled = activeNode == null || !allowUpdate;

  const isEditingDisabledMessage = messages["tracing.read_only_mode_notification"](
    isAnnotationLockedByUser,
    isOwner,
  );

  return (
    <div
      id={commentTabId}
      className="flex-column padded-tab-content"
      style={{
        height: "inherit",
      }}
    >
      <DomVisibilityObserver
        targetId={commentTabId}
        onChange={(isVisible) => {
          setIsVisibleInDom(isVisible);
        }}
      >
        {(isVisibleInDom) => {
          if (!isVisibleInDom && !isMarkdownModalOpen) {
            return null;
          }

          return (
            <React.Fragment>
              {renderMarkdownModal()}
              <CommentTabToolbar
                commentTabId={commentTabId}
                searchData={flatComments}
                onSearchSelect={onSearchSelect}
                onPreviousComment={goToPreviousComment}
                onNextComment={() => goToNextComment()}
                activeCommentContent={activeCommentContent}
                isEditingDisabled={isEditingDisabled}
                isEditingDisabledMessage={isEditingDisabledMessage}
                allowUpdate={allowUpdate}
                onChangeInput={handleChangeInput}
                onOpenMarkdownModal={() => setIsMarkdownModalOpen(true)}
                isMultilineComment={isMultilineComment}
                sortBy={sortBy}
                isSortedAscending={isSortedAscending}
                onChangeSorting={handleChangeSorting}
                onToggleSortingDirection={toggleSortingDirection}
                onToggleExpandAllTrees={toggleExpandAllTrees}
              />
              <Divider size="small" />
              <div
                style={{
                  flex: "1 1 auto",
                  listStyle: "none",
                }}
              >
                <CommentTree
                  trees={sortedTrees}
                  sortBy={sortBy}
                  isSortedAscending={isSortedAscending}
                  activeNodeId={skeletonTracing.activeNodeId}
                  expandedKeys={expandedTreeIds}
                  selectedKeys={highlightedNodeIds}
                  onExpand={setExpandedTreeIds}
                  onSelect={onSelect}
                  treeRef={treeRef}
                />
              </div>
            </React.Fragment>
          );
        }}
      </DomVisibilityObserver>
    </div>
  );
}

const CommentTabViewMemo = React.memo(
  CommentTabView,
  function arePropsEqual(prevPops: Props, nextProps: Props) {
    if (prevPops.skeletonTracing.activeNodeId !== nextProps.skeletonTracing.activeNodeId) {
      return false;
    }

    if (prevPops.skeletonTracing.activeTreeId !== nextProps.skeletonTracing.activeTreeId) {
      return false;
    }

    const updateActions = Array.from(
      cachedDiffTrees(
        nextProps.skeletonTracing.tracingId,
        prevPops.skeletonTracing.trees,
        nextProps.skeletonTracing.trees,
        false,
      ),
    );
    const relevantUpdateActions = updateActions.filter(
      (ua) =>
        RELEVANT_ACTIONS_FOR_COMMENTS.includes(ua.name) ||
        (ua.name === "createTree" && ua.value.comments.length > 0),
    );
    return relevantUpdateActions.length === 0;
  },
);

function CommentTabViewWrapper() {
  // This wrapper component serves 2 purposes:
  // 1. Prevent excessive re-renders
  // 2. Safe-guard that a skeleton tracing is available

  const skeletonTracing = useWkSelector((state) => getSkeletonTracing(state.annotation));

  if (skeletonTracing) return <CommentTabViewMemo skeletonTracing={skeletonTracing} />;

  return null;
}

export default CommentTabViewWrapper;
