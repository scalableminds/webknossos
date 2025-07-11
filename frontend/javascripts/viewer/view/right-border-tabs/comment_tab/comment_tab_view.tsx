import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DownOutlined,
  EditOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  ShrinkOutlined,
} from "@ant-design/icons";
import { Tree as AntdTree, Dropdown, type GetRef, Space, Tooltip, type TreeProps } from "antd";
import type { EventDataNode } from "antd/es/tree";
import { useLifecycle } from "beautiful-react-hooks";
import { InputKeyboard } from "libs/input";
import { useEffectOnlyOnce } from "libs/react_hooks";
import { useWkSelector } from "libs/react_hooks";
import { compareBy, localeCompareBy } from "libs/utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import messages from "messages";
import type { MenuProps } from "rc-menu";
import React, { useEffect, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import AutoSizer from "react-virtualized-auto-sizer";
import type { Comparator } from "types/globals";
import { isAnnotationOwner } from "viewer/model/accessors/annotation_accessor";
import { getActiveNode, getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  createCommentAction,
  deleteCommentAction,
  setActiveNodeAction,
} from "viewer/model/actions/skeletontracing_actions";
import { cachedDiffTrees } from "viewer/model/sagas/skeletontracing_saga";
import type { CommentType, MutableCommentType, Tree, TreeMap } from "viewer/model/types/tree_types";
import type { SkeletonTracing } from "viewer/store";
import ButtonComponent from "viewer/view/components/button_component";
import DomVisibilityObserver from "viewer/view/components/dom_visibility_observer";
import InputComponent from "viewer/view/components/input_component";
import { MarkdownModal } from "viewer/view/components/markdown_modal";
import { Comment, commentListId } from "viewer/view/right-border-tabs/comment_tab/comment";
import AdvancedSearchPopover from "../advanced_search_popover";
import { ColoredDotIcon } from "../segments_tab/segment_list_item";

const commentTabId = "commentTabId";
enum SortByEnum {
  NAME = "NAME",
  ID = "ID",
  NATURAL = "NATURAL",
}

function getTreeSorter(sortBy: SortByEnum, isSortedAscending: boolean): Comparator<Tree> {
  return sortBy === SortByEnum.ID
    ? compareBy<Tree>((tree) => tree.treeId, isSortedAscending)
    : localeCompareBy<Tree>(
        (tree) => `${tree.name}_${tree.treeId}`,
        isSortedAscending,
        sortBy === SortByEnum.NATURAL,
      );
}

function getCommentSorter(sortBy: SortByEnum, isSortedAscending: boolean): Comparator<CommentType> {
  return sortBy === SortByEnum.ID
    ? compareBy<CommentType>((comment) => comment.nodeId, isSortedAscending)
    : localeCompareBy<CommentType>(
        (comment) => `${comment.content}_${comment.nodeId}`,
        isSortedAscending,
        sortBy === SortByEnum.NATURAL,
      );
}

const RELEVANT_ACTIONS_FOR_COMMENTS = [
  "updateTree",
  "deleteTree",
  "mergeTree",
  "moveTreeComponent",
  "deleteEdge",
  "revertToVersion",
];

function getSortedTreesWithComments(
  trees: TreeMap,
  sortBy: SortByEnum,
  isSortedAscending: boolean,
): Tree[] {
  return trees
    .values()
    .filter((tree) => tree.comments.length > 0)
    .toArray()
    .sort(getTreeSorter(sortBy, isSortedAscending));
}

const memoizedDeriveData = memoizeOne(
  (trees: TreeMap, sortBy: SortByEnum, isSortedAscending: boolean): Tree[] => {
    const sortedTrees = getSortedTreesWithComments(trees, sortBy, isSortedAscending);

    return sortedTrees;
  },
);

type Props = {
  skeletonTracing: SkeletonTracing;
};

function CommentTabView(props: Props) {
  const treeRef = useRef<GetRef<typeof AntdTree>>(null);

  const [isSortedAscending, setIsSortedAscending] = useState(true);
  const [sortBy, setSortBy] = useState(SortByEnum.NAME);
  const [expandedTreeIds, setExpandedTreeIds] = useState<React.Key[]>([]);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<React.Key[]>([]);
  const [isMarkdownModalOpen, setIsMarkdownModalOpen] = useState(false);
  const [isVisibleInDom, setIsVisibleInDom] = useState(true);

  const [keyboard, setKeyboard] = useState<InputKeyboard | null>(null);
  const nextCommentRef = useRef<(arg0?: boolean) => void>();
  const previousCommentRef = useRef<() => void>();

  const dispatch = useDispatch();

  const allowUpdate = useWkSelector((state) => state.annotation.restrictions.allowUpdate);
  const keyboardDelay = useWkSelector((state) => state.userConfiguration.keyboardDelay);

  const isAnnotationLockedByUser = useWkSelector((state) => state.annotation.isLockedByOwner);
  const isOwner = useWkSelector((state) => isAnnotationOwner(state));

  const activeComment = useWkSelector((_state) => getActiveComment());

  useEffectOnlyOnce(() => {
    // expand all trees by default
    const defaultCollapsedTreeIds = getData().map((tree) => tree.treeId.toString());
    setExpandedTreeIds(defaultCollapsedTreeIds);
  });

  useLifecycle(
    () => {
      // This keyboard handler is created only once on the very first render.
      // Instead of directly attaching callback function, we need to rely on React.refs instead
      // to prevent the callbacks from becoming stale and outdated as the component changes
      // its state or props.
      const newKeyboard = new InputKeyboard(
        {
          n: () => {
            if (nextCommentRef?.current) nextCommentRef.current();
          },
          p: () => {
            if (previousCommentRef?.current) previousCommentRef.current();
          },
        },
        {
          delay: keyboardDelay,
        },
      );
      if (keyboard === null) setKeyboard(newKeyboard);
    },
    () => {
      keyboard?.destroy();
    },
  );

  useEffect(() => {
    if (keyboard) keyboard.delay = keyboardDelay;
  }, [keyboard, keyboardDelay]);

  useEffect(() => {
    // If the activeNode has a comment, scroll to it,
    // otherwise scroll to the activeTree
    if (isVisibleInDom) {
      scrollToActiveCommentOrTree(activeComment, props.skeletonTracing.activeTreeId);
    }
  }, [activeComment, props.skeletonTracing.activeTreeId, isVisibleInDom]);

  function scrollToActiveCommentOrTree(
    activeComment: MutableCommentType | undefined,
    activeTreeId: number | undefined | null,
  ) {
    // scroll to the current comment of the active node
    // or in case there is no comment to it's parent tree

    // Technically the comment is now present in the tree and it can also be found while debugging
    // this class. But due to some React or virtual rendering magic in the scrollTo function,
    // the new comment isn't found right away in the tree data, thus the timeout is used as a work-around.

    setTimeout(() => {
      if (treeRef.current)
        if (activeComment) {
          const commentNodeKey = `comment-${activeComment.nodeId}`;
          treeRef.current.scrollTo({ key: commentNodeKey, align: "top" });
          setHighlightedNodeIds([commentNodeKey]);
        } else if (activeTreeId) {
          const treeNodeKey = activeTreeId.toString();
          treeRef.current.scrollTo({
            key: treeNodeKey,
            align: "top",
          });
          setHighlightedNodeIds([treeNodeKey]);
        }
    });
  }

  function nextComment(forward: boolean = true) {
    const activeNode = getActiveNode(props.skeletonTracing);
    if (activeNode != null) {
      const sortAscending = forward ? isSortedAscending : !isSortedAscending;
      const { trees } = props.skeletonTracing;

      // Create a sorted, flat array of all comments across all trees
      const sortedTrees = getSortedTreesWithComments(trees, sortBy, sortAscending);

      const sortedComments = sortedTrees.flatMap((tree: Tree): CommentType[] =>
        tree.comments.slice().sort(getCommentSorter(sortBy, sortAscending)),
      );

      const currentCommentIndex = sortedComments.findIndex(
        (comment) => comment.nodeId === activeNode.id,
      );

      const nextCommentIndex = (currentCommentIndex + 1) % sortedComments.length;

      if (nextCommentIndex >= 0 && nextCommentIndex < sortedComments.length) {
        setActiveNode(sortedComments[nextCommentIndex].nodeId);
      }
    }
  }
  nextCommentRef.current = nextComment;

  function previousComment() {
    nextComment(false);
  }
  previousCommentRef.current = previousComment;

  function setActiveNode(nodeId: number) {
    dispatch(setActiveNodeAction(nodeId));
  }

  function deleteComment() {
    dispatch(deleteCommentAction());
  }

  function createComment(text: string) {
    dispatch(createCommentAction(text));
  }

  function handleChangeInput(commentText: string, insertLineBreaks: boolean = false) {
    if (commentText) {
      createComment(insertLineBreaks ? commentText.replace(/\\n/g, "\n") : commentText);

      // make sure that the skeleton tree node is expanded
      if (props.skeletonTracing.activeTreeId)
        setExpandedTreeIds([...expandedTreeIds, props.skeletonTracing.activeTreeId.toString()]);
    } else {
      deleteComment();
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
      const shouldBeCollapsed = !_.isEmpty(prevState);
      return shouldBeCollapsed ? [] : getData().map((tree) => tree.treeId.toString());
    });
  }

  function onExpand(expandedKeys: React.Key[]) {
    setExpandedTreeIds(expandedKeys);
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

  function getActiveComment(): MutableCommentType | undefined {
    const { activeTreeId, activeNodeId } = props.skeletonTracing;

    if (activeTreeId && activeNodeId) {
      const activeComment = props.skeletonTracing.trees
        .getOrThrow(activeTreeId)
        .comments.find((comment) => comment.nodeId === activeNodeId);

      return activeComment;
    }
    return undefined;
  }

  function setMarkdownModalVisibility(visible: boolean) {
    setIsMarkdownModalOpen(visible);
  }

  function renderMarkdownModal() {
    if (!allowUpdate || !props.skeletonTracing.activeNodeId) {
      return null;
    }

    const onOk = () => setMarkdownModalVisibility(false);

    let comment = activeComment;
    if (!comment) {
      comment = {
        nodeId: props.skeletonTracing.activeNodeId,
        content: "",
      };
    }

    return (
      <MarkdownModal
        key={comment.nodeId}
        source={comment.content}
        isOpen={isMarkdownModalOpen}
        onChange={handleChangeInput}
        onOk={onOk}
        label="Comment"
      />
    );
  }

  function renderSortIcon() {
    const sortAsc = isSortedAscending;
    const sortNumeric = sortBy === SortByEnum.ID;
    const iconClass = `fas fa-sort-${sortNumeric ? "numeric" : "alpha"}-${sortAsc ? "down" : "up"}`;
    return <i className={iconClass} />;
  }

  function getSortDropdown(): MenuProps {
    return {
      selectedKeys: [sortBy],
      onClick: handleChangeSorting,
      items: [
        { key: SortByEnum.NAME, label: "by name" },
        { key: SortByEnum.ID, label: "by creation time" },
        {
          key: SortByEnum.NATURAL,
          label: (
            <>
              by name (natural sort)
              <Tooltip title={messages["tracing.natural_sorting"]} placement="bottomLeft">
                {" "}
                <InfoCircleOutlined />
              </Tooltip>
            </>
          ),
        },
      ],
    };
  }

  function getData(): Tree[] {
    return memoizedDeriveData(props.skeletonTracing.trees, sortBy, isSortedAscending);
  }

  function renderCommentTree() {
    const skeletonTracingTrees = getData();

    const treeData: TreeProps["treeData"] = skeletonTracingTrees.map((tree) => {
      const commentSorter = getCommentSorter(sortBy, isSortedAscending);

      return {
        key: tree.treeId.toString(),
        title: (
          <div style={{ wordBreak: "break-all" }}>
            <ColoredDotIcon colorRGBA={[...tree.color, 1.0]} /> {tree.name}
          </div>
        ),
        expanded: true,
        children: tree.comments
          .slice()
          .sort(commentSorter)
          .map((comment) => {
            const key = `comment-${comment.nodeId}`;
            const isActive = comment.nodeId === props.skeletonTracing.activeNodeId;
            return {
              ...comment,
              key: key,
              title: <Comment key={key} comment={comment} isActive={isActive} />,
            };
          }),
      };
    });

    return (
      <AutoSizer defaultHeight={500}>
        {({ height, width }) => (
          <div
            style={{
              height,
              width,
            }}
          >
            <AntdTree
              key={commentListId}
              treeData={treeData}
              expandedKeys={expandedTreeIds}
              selectedKeys={highlightedNodeIds}
              onExpand={onExpand}
              // @ts-ignore
              onSelect={onSelect}
              switcherIcon={<DownOutlined />}
              height={height}
              ref={treeRef}
              blockNode
              showLine
              defaultExpandAll
            />
          </div>
        )}
      </AutoSizer>
    );
  }

  // Replace line breaks as they will otherwise be stripped when shown in an input field
  const activeCommentContent = activeComment?.content.replace(/\r?\n/g, "\\n");
  const isMultilineComment = activeCommentContent?.indexOf("\\n") !== -1;
  const activeNode = getActiveNode(props.skeletonTracing);
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
              <Space.Compact className="compact-items compact-icons">
                <AdvancedSearchPopover
                  onSelect={(comment) => {
                    setActiveNode(comment.nodeId);

                    const tree = getData().find((tree) => tree.nodes.has(comment.nodeId));
                    if (tree) {
                      setExpandedTreeIds(_.uniq([...expandedTreeIds, tree.treeId.toString()]));
                    }
                  }}
                  data={_.flatMap(getData(), (tree) =>
                    tree.comments.slice().sort(getCommentSorter(sortBy, isSortedAscending)),
                  )}
                  searchKey="content"
                  targetId={commentListId}
                >
                  <ButtonComponent icon={<SearchOutlined />} title="Search through comments" />
                </AdvancedSearchPopover>
                <ButtonComponent
                  title="Jump to previous comment"
                  onClick={previousComment}
                  icon={<ArrowLeftOutlined />}
                />
                <InputComponent
                  value={activeCommentContent}
                  disabled={isEditingDisabled}
                  title={allowUpdate ? undefined : isEditingDisabledMessage}
                  onChange={(evt: React.ChangeEvent<HTMLInputElement>) =>
                    handleChangeInput(evt.target.value, true)
                  }
                  onPressEnter={(evt: React.KeyboardEvent<HTMLInputElement>) =>
                    (evt.target as HTMLElement).blur()
                  }
                  placeholder="Add comment"
                />
                <ButtonComponent
                  onClick={() => setMarkdownModalVisibility(true)}
                  disabled={isEditingDisabled}
                  title={
                    allowUpdate
                      ? "Open dialog to edit comment in multi-line mode"
                      : isEditingDisabledMessage
                  }
                  type={isMultilineComment ? "primary" : "default"}
                  icon={<EditOutlined />}
                />
                <ButtonComponent
                  title="Jump to next comment"
                  onClick={() => nextComment()}
                  icon={<ArrowRightOutlined />}
                />
                <Dropdown menu={getSortDropdown()} trigger={["click"]}>
                  <ButtonComponent title="Sort" onClick={toggleSortingDirection}>
                    {renderSortIcon()}
                  </ButtonComponent>
                </Dropdown>
                <ButtonComponent
                  onClick={toggleExpandAllTrees}
                  icon={<ShrinkOutlined />}
                  title="Collapse or expand groups"
                />
              </Space.Compact>
              <div
                style={{
                  flex: "1 1 auto",
                  marginTop: 20,
                  listStyle: "none",
                }}
              >
                {renderCommentTree()}
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
