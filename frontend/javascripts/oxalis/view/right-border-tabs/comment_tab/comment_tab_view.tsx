import { Dropdown, Tooltip, Space, Tree as AntdTree, TreeProps } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  DownOutlined,
  EditOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  ShrinkOutlined,
} from "@ant-design/icons";
import { useDispatch, useSelector } from "react-redux";
import Maybe from "data.maybe";
import React, { useEffect, useRef, useState } from "react";
import _, { get } from "lodash";
import memoizeOne from "memoize-one";
import { Comment, commentListId } from "oxalis/view/right-border-tabs/comment_tab/comment";
import { toNullable, compareBy, localeCompareBy, zipMaybe } from "libs/utils";
import { InputKeyboard } from "libs/input";
import { MarkdownModal } from "oxalis/view/components/markdown_modal";
import { cachedDiffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import {
  getActiveTree,
  getActiveNode,
  getSkeletonTracing,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import {
  setActiveNodeAction,
  createCommentAction,
  deleteCommentAction,
} from "oxalis/model/actions/skeletontracing_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import InputComponent from "oxalis/view/components/input_component";
import type { CommentType, OxalisState, SkeletonTracing, Tree, TreeMap } from "oxalis/store";
import messages from "messages";
import AdvancedSearchPopover from "../advanced_search_popover";
import type { MenuProps } from "rc-menu";
import { Comparator } from "types/globals";
import type RcTree from "rc-tree";
import { EventDataNode } from "antd/es/tree";

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

const memoizedDeriveData = memoizeOne(
  (trees: TreeMap, sortBy: SortByEnum, isSortedAscending: boolean): Tree[] => {
    const sortedTrees = _.values(trees)
      .filter((tree) => tree.comments.length > 0)
      .sort(getTreeSorter(sortBy, isSortedAscending));

    return sortedTrees;
  },
);

function CommentTabView(props: {
  skeletonTracing: SkeletonTracing;
}) {
  // const storePropertyUnsubscribers =  Array<() => void> = [];
  // const keyboard = new InputKeyboard(
  //   {
  //     n: () => nextComment(),
  //     p: () => previousComment(),
  //   },
  //   {
  //     delay: Store.getState().userConfiguration.keyboardDelay,
  //   },
  // );

  const treeRef = useRef<AntdTree>();

  const [isSortedAscending, setIsSortedAscending] = useState(true);
  const [sortBy, setSortBy] = useState(SortByEnum.NAME);
  const [collapsedTreeIds, setCollapsedTreeIds] = useState<React.Key[]>([]);
  const [isMarkdownModalOpen, setIsMarkdownModalOpen] = useState(false);

  const dispatch = useDispatch();
  const allowUpdate = useSelector((state: OxalisState) => state.tracing.restrictions.allowUpdate);

  useEffect(() => {
    const defaultCollapsedTreeIds = getData().map((tree) => tree.treeId.toString());
    setCollapsedTreeIds(defaultCollapsedTreeIds);
  }, []);

  // useEffect(()=> {
  //   storePropertyUnsubscribers.push(
  //     listenToStoreProperty(
  //       (state) => userConfiguration.keyboardDelay,
  //       (keyboardDelay) => {
  //         if (keyboard != null) {
  //           keyboard.delay = keyboardDelay;
  //         }
  //       },
  //     ),
  //   );
  // }, [])

  // shouldComponentUpdate(nextProps: PropsWithSkeleton, nextState: CommentTabState) {
  //   if (nextState !== state) {
  //     return true;
  //   }

  //   if (props.skeletonTracing.activeNodeId !== nextProps.skeletonTracing.activeNodeId) {
  //     return true;
  //   }

  //   if (props.skeletonTracing.activeTreeId !== nextProps.skeletonTracing.activeTreeId) {
  //     return true;
  //   }

  //   const updateActions = Array.from(
  //     cachedDiffTrees(props.skeletonTracing.trees, nextProps.skeletonTracing.trees),
  //   );
  //   const relevantUpdateActions = updateActions.filter(
  //     (ua) =>
  //       RELEVANT_ACTIONS_FOR_COMMENTS.includes(ua.name) ||
  //       (ua.name === "createTree" && ua.value.comments.length > 0),
  //   );
  //   return relevantUpdateActions.length > 0;
  // }

  // componentDidUpdate(prevProps: PropsWithSkeleton) {
  //   if (
  //     listRef != null &&
  //     prevProps.skeletonTracing.trees !== props.skeletonTracing.trees
  //   ) {
  //     // Force the virtualized list to update if a comment was changed
  //     // as it only rerenders if the rowCount changed otherwise
  //     listRef.forceUpdateGrid();
  //   }
  // }

  // componentWillUnmount() {
  //   keyboard.destroy();
  //   unsubscribeStoreListeners();
  // }

  function nextComment(forward: boolean = true) {
    getActiveNode(props.skeletonTracing).map((activeNode) => {
      const sortAscending = forward ? isSortedAscending : !isSortedAscending;
      const { trees } = props.skeletonTracing;

      // Create a sorted, flat array of all comments across all trees
      const sortedTrees = _.values(trees).slice().sort(getTreeSorter(sortBy, isSortedAscending));

      const sortedComments = _.flatMap(sortedTrees, (tree: Tree): CommentType[] =>
        tree.comments.slice().sort(getCommentSorter(sortBy, sortAscending)),
      );

      const currentCommentIndex = _.findIndex(sortedComments, {
        nodeId: activeNode.id,
      });

      const nextCommentIndex = (currentCommentIndex + 1) % sortedComments.length;

      if (nextCommentIndex >= 0 && nextCommentIndex < sortedComments.length) {
        setActiveNode(sortedComments[nextCommentIndex].nodeId);
      }
    });
  }

  function setActiveNode(nodeId: number) {
    dispatch(setActiveNodeAction(nodeId));
  }

  function previousComment() {
    nextComment(false);
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
    setCollapsedTreeIds((prevState) => {
      const shouldBeCollapsed = !_.isEmpty(prevState);
      return shouldBeCollapsed ? [] : getData().map((tree) => tree.treeId.toString());
    });
  }

  function onExpand(expandedKeys: React.Key[]) {
    setCollapsedTreeIds(expandedKeys);
  }

  function onSelect(_selectedKeys: React.Key[], { node }) {
    if (node.key.startsWith("comment")) {
      // "comment" keys have the format "comment-{treeId}-{nodeId}"
      const nodeId = parseInt(node.key.split("-")[2]);
      setActiveNode(nodeId);
    }
  }

  // function unsubscribeStoreListeners() {
  //   storePropertyUnsubscribers.forEach((unsubscribe) => unsubscribe());
  //   storePropertyUnsubscribers = [];
  // }

  function getActiveComment(createIfNotExisting: boolean = false) {
    return zipMaybe(
      getActiveTree(props.skeletonTracing),
      getActiveNode(props.skeletonTracing),
    ).chain(([tree, activeNode]) =>
      Maybe.fromNullable(tree.comments.find((comment) => comment.nodeId === activeNode.id)).orElse(
        () =>
          // If there is no active comment and createIfNotExisting is set, create an empty comment
          Maybe.fromNullable(
            createIfNotExisting
              ? {
                  nodeId: activeNode.id,
                  content: "",
                }
              : null,
          ),
      ),
    );
  }

  function setMarkdownModalVisibility(visible: boolean) {
    setIsMarkdownModalOpen(visible);
  }

  function renderMarkdownModal() {
    if (!allowUpdate) {
      return null;
    }
    const activeCommentMaybe = getActiveComment(true);

    const onOk = () => setMarkdownModalVisibility(false);

    return toNullable(
      activeCommentMaybe.map((comment) => (
        <MarkdownModal
          key={comment.nodeId}
          source={comment.content}
          isOpen={isMarkdownModalOpen}
          onChange={handleChangeInput}
          onOk={onOk}
          label="Comment"
        />
      )),
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

  function highlightActiveNode(node: EventDataNode) {
    const activeNodeId = props.skeletonTracing.activeNodeId;
    return node.key.endsWith(activeNodeId);
  }

  function renderCommentTree() {
    const skeletonTracingTrees = getData();

    const treeData: TreeProps["treeData"] = skeletonTracingTrees.map((tree) => {
      const commentSorter = getCommentSorter(sortBy, isSortedAscending);

      return {
        key: tree.treeId.toString(),
        title: tree.name,
        expanded: true,
        children: tree.comments
          .slice()
          .sort(commentSorter)
          .map((comment) => {
            const key = `comment-${tree.treeId}-${comment.nodeId}`;
            const isActive = comment.nodeId === props.skeletonTracing.activeNodeId;
            return { key: key, title: <Comment key={key} comment={comment} isActive={isActive} /> };
          }),
      };
    });

    return (
      <AntdTree
        key={commentListId}
        treeData={treeData}
        expandedKeys={collapsedTreeIds}
        onExpand={onExpand}
        onSelect={onSelect}
        switcherIcon={<DownOutlined />}
        filterTreeNode={highlightActiveNode}
        ref={treeRef}
        blockNode
        showLine
        defaultExpandAll
      />
    );
  }

  const activeCommentMaybe = getActiveComment();
  // Replace line breaks as they will otherwise be stripped when shown in an input field
  const activeCommentContent = activeCommentMaybe
    .map((comment) => comment.content)
    .getOrElse("")
    .replace(/\r?\n/g, "\\n");
  const isMultilineComment = activeCommentContent.indexOf("\\n") !== -1;
  const activeNodeMaybe = getActiveNode(props.skeletonTracing);
  const isEditingDisabled = activeNodeMaybe.isNothing || !allowUpdate;

  const findCommentIndexFn = (commentOrTree: Tree | CommentType) =>
    "nodeId" in commentOrTree && commentOrTree.nodeId === props.skeletonTracing.activeNodeId;

  const findTreeIndexFn = (commentOrTree: Tree | CommentType) =>
    "treeId" in commentOrTree && commentOrTree.treeId === props.skeletonTracing.activeTreeId;

  return (
    <div
      id={commentTabId}
      className="flex-column padded-tab-content"
      style={{
        height: "inherit",
      }}
    >
      <DomVisibilityObserver targetId={commentTabId}>
        {(isVisibleInDom) => {
          if (!isVisibleInDom && !isMarkdownModalOpen) {
            return null;
          }

          // If the activeNode has a comment, scroll to it,
          // otherwise scroll to the activeTree
          const scrollIndex = _.findIndex(
            getData(),
            activeCommentMaybe.isJust ? findCommentIndexFn : findTreeIndexFn,
          );

          return (
            <React.Fragment>
              {renderMarkdownModal()}
              <Space.Compact className="compact-items compact-icons">
                <AdvancedSearchPopover
                  onSelect={(comment) => setActiveNode(comment.nodeId)}
                  data={_.flatMap(props.skeletonTracing.trees, (tree) => tree.comments)}
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
                  title={allowUpdate ? undefined : messages["tracing.read_only_mode_notification"]}
                  onChange={(evt: React.ChangeEvent<HTMLInputElement>) =>
                    handleChangeInput(evt.target.value, true)
                  }
                  onPressEnter={(evt: React.KeyboardEvent<HTMLInputElement>) =>
                    (evt.target as HTMLElement).blur()
                  }
                  placeholder="Add comment"
                  style={{
                    width: "50%",
                  }}
                />
                <ButtonComponent
                  onClick={() => setMarkdownModalVisibility(true)}
                  disabled={isEditingDisabled}
                  title={
                    allowUpdate
                      ? "Open dialog to edit comment in multi-line mode"
                      : messages["tracing.read_only_mode_notification"]
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

function CommentTabViewWrapper() {
  const skeletonTracing = useSelector((state: OxalisState) =>
    getSkeletonTracing(state.tracing).getOrElse(null),
  );
  if (skeletonTracing) return <CommentTabView skeletonTracing={skeletonTracing} />;

  return null;
}

export default CommentTabViewWrapper;
