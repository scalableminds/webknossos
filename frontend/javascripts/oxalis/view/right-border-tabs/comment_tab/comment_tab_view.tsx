import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  EditOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  ShrinkOutlined,
} from "@ant-design/icons";
import { Dropdown, Space, Tooltip } from "antd";
import Maybe from "data.maybe";
import update from "immutability-helper";
import { InputKeyboard } from "libs/input";
import { Comparator, compareBy, localeCompareBy, toNullable, zipMaybe } from "libs/utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import messages from "messages";
import { getActiveNode, getActiveTree } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  createCommentAction,
  deleteCommentAction,
  setActiveNodeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { cachedDiffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import type { CommentType, OxalisState, SkeletonTracing, Tree, TreeMap } from "oxalis/store";
import Store from "oxalis/store";
import ButtonComponent from "oxalis/view/components/button_component";
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import InputComponent from "oxalis/view/components/input_component";
import { MarkdownModal } from "oxalis/view/components/markdown_modal";
import { makeSkeletonTracingGuard } from "oxalis/view/guards";
import { Comment, commentListId } from "oxalis/view/right-border-tabs/comment_tab/comment";
import TreeWithComments from "oxalis/view/right-border-tabs/comment_tab/tree_with_comments";
import type { MenuProps } from "rc-menu";
import * as React from "react";
import { connect } from "react-redux";
import { AutoSizer, List } from "react-virtualized";
import type { Dispatch } from "redux";
import AdvancedSearchPopover from "../advanced_search_popover";

const treeTypeHint = [] as Array<Tree>;
const commentTypeHint = [] as Array<CommentType>;
const commentTabId = "commentTabId";
enum SortByEnum {
  NAME = "NAME",
  ID = "ID",
  NATURAL = "NATURAL",
}

type SortByEnumType = keyof typeof SortByEnum;
type SortOptions = {
  sortBy: SortByEnumType;
  isSortedAscending: boolean;
};

function getTreeSorter({ sortBy, isSortedAscending }: SortOptions): Comparator<Tree> {
  return sortBy === SortByEnum.ID
    ? compareBy(treeTypeHint, (tree) => tree.treeId, isSortedAscending)
    : localeCompareBy(
        treeTypeHint,
        (tree) => `${tree.name}_${tree.treeId}`,
        isSortedAscending,
        sortBy === SortByEnum.NATURAL,
      );
}

function getCommentSorter({ sortBy, isSortedAscending }: SortOptions): Comparator<CommentType> {
  return sortBy === SortByEnum.ID
    ? compareBy([] as Array<CommentType>, (comment) => comment.nodeId, isSortedAscending)
    : localeCompareBy(
        commentTypeHint,
        (comment) => `${comment.content}_${comment.nodeId}`,
        isSortedAscending,
        sortBy === SortByEnum.NATURAL,
      );
}

type StateProps = {
  skeletonTracing: SkeletonTracing | null | undefined;
  allowUpdate: boolean;
  setActiveNode: (nodeId: number) => void;
  deleteComment: () => void;
  createComment: (text: string) => void;
};
type Props = StateProps;
type PropsWithSkeleton = Props & {
  skeletonTracing: SkeletonTracing;
};
type CommentTabState = {
  isSortedAscending: boolean;
  sortBy: SortByEnumType;
  collapsedTreeIds: Record<number, boolean>;
  isMarkdownModalOpen: boolean;
};
const RELEVANT_ACTIONS_FOR_COMMENTS = [
  "updateTree",
  "deleteTree",
  "mergeTree",
  "moveTreeComponent",
  "deleteEdge",
  "revertToVersion",
];
const memoizedDeriveData = memoizeOne(
  (trees: TreeMap, state: CommentTabState): Array<Tree | CommentType> => {
    const sortedTrees = _.values(trees)
      .filter((tree) => tree.comments.length > 0)
      .sort(getTreeSorter(state));

    const commentSorter = getCommentSorter(state);
    const data = [];

    for (const tree of sortedTrees) {
      data.push(tree);
      const isCollapsed = state.collapsedTreeIds[tree.treeId];

      if (!isCollapsed && tree.comments.length > 0) {
        const sortedComments = tree.comments.slice().sort(commentSorter);

        // Don't use concat to avoid creating a new `data` array for each tree
        for (const comment of sortedComments) {
          data.push(comment);
        }
      }
    }

    return data;
  },
);

class CommentTabView extends React.Component<PropsWithSkeleton, CommentTabState> {
  listRef: List | null | undefined;
  storePropertyUnsubscribers: Array<() => void> = [];
  keyboard = new InputKeyboard(
    {
      n: () => this.nextComment(),
      p: () => this.previousComment(),
    },
    {
      delay: Store.getState().userConfiguration.keyboardDelay,
    },
  );

  state: CommentTabState = {
    isSortedAscending: true,
    sortBy: SortByEnum.NAME,
    collapsedTreeIds: {},
    isMarkdownModalOpen: false,
  };

  componentDidMount() {
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        (state) => state.userConfiguration.keyboardDelay,
        (keyboardDelay) => {
          if (this.keyboard != null) {
            this.keyboard.delay = keyboardDelay;
          }
        },
      ),
    );
  }

  shouldComponentUpdate(nextProps: PropsWithSkeleton, nextState: CommentTabState) {
    if (nextState !== this.state) {
      return true;
    }

    if (this.props.skeletonTracing.activeNodeId !== nextProps.skeletonTracing.activeNodeId) {
      return true;
    }

    if (this.props.skeletonTracing.activeTreeId !== nextProps.skeletonTracing.activeTreeId) {
      return true;
    }

    const updateActions = Array.from(
      cachedDiffTrees(this.props.skeletonTracing.trees, nextProps.skeletonTracing.trees),
    );
    const relevantUpdateActions = updateActions.filter(
      (ua) =>
        RELEVANT_ACTIONS_FOR_COMMENTS.includes(ua.name) ||
        (ua.name === "createTree" && ua.value.comments.length > 0),
    );
    return relevantUpdateActions.length > 0;
  }

  componentDidUpdate(prevProps: PropsWithSkeleton) {
    if (
      this.listRef != null &&
      prevProps.skeletonTracing.trees !== this.props.skeletonTracing.trees
    ) {
      // Force the virtualized list to update if a comment was changed
      // as it only rerenders if the rowCount changed otherwise
      this.listRef.forceUpdateGrid();
    }
  }

  componentWillUnmount() {
    this.keyboard.destroy();
    this.unsubscribeStoreListeners();
  }

  nextComment = (forward: boolean = true) => {
    getActiveNode(this.props.skeletonTracing).map((activeNode) => {
      const { isSortedAscending, sortBy } = this.state;
      const sortAscending = forward ? isSortedAscending : !isSortedAscending;
      const { trees } = this.props.skeletonTracing;

      // Create a sorted, flat array of all comments across all trees
      const sortedTrees = _.values(trees)
        .slice()
        .sort(
          getTreeSorter({
            sortBy,
            isSortedAscending: sortAscending,
          }),
        );

      const sortedComments = _.flatMap(
        sortedTrees,
        (tree: Tree): Array<CommentType> =>
          tree.comments.slice().sort(
            getCommentSorter({
              sortBy,
              isSortedAscending: sortAscending,
            }),
          ),
      );

      const currentCommentIndex = _.findIndex(sortedComments, {
        nodeId: activeNode.id,
      });

      const nextCommentIndex = (currentCommentIndex + 1) % sortedComments.length;

      if (nextCommentIndex >= 0 && nextCommentIndex < sortedComments.length) {
        this.props.setActiveNode(sortedComments[nextCommentIndex].nodeId);
      }
    });
  };

  previousComment = () => {
    this.nextComment(false);
  };

  handleChangeInput = (
    evt: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    insertLineBreaks: boolean = false,
  ) => {
    // @ts-ignore
    const commentText = evt.target.value;

    if (commentText) {
      this.props.createComment(insertLineBreaks ? commentText.replace(/\\n/g, "\n") : commentText);
    } else {
      this.props.deleteComment();
    }
  };

  handleChangeSorting = ({ key }: { key: any }) => {
    this.setState({
      sortBy: key as SortByEnum,
    });
  };

  toggleSortingDirection = () => {
    this.setState((prevState) => ({
      isSortedAscending: !prevState.isSortedAscending,
    }));
  };

  toggleExpandForAllTrees = () => {
    this.setState((prevState) => {
      const shouldBeCollapsed = !_.values(prevState.collapsedTreeIds).some((bool) => bool);
      const collapsedTreeIds = shouldBeCollapsed
        ? _.mapValues(this.props.skeletonTracing.trees, () => true)
        : {};
      return {
        collapsedTreeIds,
      };
    });
  };

  toggleExpand = (treeId: number) => {
    this.setState((prevState) => ({
      collapsedTreeIds: update(prevState.collapsedTreeIds, {
        $toggle: [treeId],
      }),
    }));
  };

  unsubscribeStoreListeners() {
    this.storePropertyUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.storePropertyUnsubscribers = [];
  }

  getActiveComment(createIfNotExisting: boolean = false) {
    return zipMaybe(
      getActiveTree(this.props.skeletonTracing),
      getActiveNode(this.props.skeletonTracing),
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

  setMarkdownModalVisibility = (visible: boolean) => {
    this.setState({
      isMarkdownModalOpen: visible,
    });
  };

  renderMarkdownModal() {
    if (!this.props.allowUpdate) {
      return null;
    }
    const activeCommentMaybe = this.getActiveComment(true);

    const onOk = () => this.setMarkdownModalVisibility(false);

    return toNullable(
      activeCommentMaybe.map((comment) => (
        <MarkdownModal
          key={comment.nodeId}
          source={comment.content}
          isOpen={this.state.isMarkdownModalOpen}
          onChange={this.handleChangeInput}
          onOk={onOk}
          label="Comment"
        />
      )),
    );
  }

  renderSortIcon() {
    const sortAsc = this.state.isSortedAscending;
    const sortNumeric = this.state.sortBy === SortByEnum.ID;
    const iconClass = `fas fa-sort-${sortNumeric ? "numeric" : "alpha"}-${sortAsc ? "down" : "up"}`;
    return <i className={iconClass} />;
  }

  getSortDropdown(): MenuProps {
    return {
      selectedKeys: [this.state.sortBy],
      onClick: this.handleChangeSorting,
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

  getData(): Array<Tree | CommentType> {
    return memoizedDeriveData(this.props.skeletonTracing.trees, this.state);
  }

  renderRow = ({
    index,
    key,
    style,
  }: {
    index: number;
    key: string;
    style: React.CSSProperties;
  }) => {
    const element = this.getData()[index];
    if ("treeId" in element) {
      const tree = element;
      return (
        <TreeWithComments
          key={key}
          style={style}
          tree={tree}
          collapsed={this.state.collapsedTreeIds[tree.treeId]}
          onExpand={this.toggleExpand}
          isActive={tree.treeId === this.props.skeletonTracing.activeTreeId}
        />
      );
    } else {
      const comment = element;
      const isActive = comment.nodeId === this.props.skeletonTracing.activeNodeId;
      return <Comment key={key} style={style} comment={comment} isActive={isActive} />;
    }
  };

  render() {
    const activeCommentMaybe = this.getActiveComment();
    // Replace line breaks as they will otherwise be stripped when shown in an input field
    const activeCommentContent = activeCommentMaybe
      .map((comment) => comment.content)
      .getOrElse("")
      .replace(/\r?\n/g, "\\n");
    const isMultilineComment = activeCommentContent.indexOf("\\n") !== -1;
    const activeNodeMaybe = getActiveNode(this.props.skeletonTracing);
    const isEditingDisabled = activeNodeMaybe.isNothing || !this.props.allowUpdate;

    const findCommentIndexFn = (commentOrTree: Tree | CommentType) =>
      "nodeId" in commentOrTree && commentOrTree.nodeId === this.props.skeletonTracing.activeNodeId;

    const findTreeIndexFn = (commentOrTree: Tree | CommentType) =>
      "treeId" in commentOrTree && commentOrTree.treeId === this.props.skeletonTracing.activeTreeId;

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
            if (!isVisibleInDom && !this.state.isMarkdownModalOpen) {
              return null;
            }

            // If the activeNode has a comment, scroll to it,
            // otherwise scroll to the activeTree
            const scrollIndex = _.findIndex(
              this.getData(),
              activeCommentMaybe.isJust ? findCommentIndexFn : findTreeIndexFn,
            );

            return (
              <React.Fragment>
                {this.renderMarkdownModal()}
                <Space.Compact className="compact-items compact-icons">
                  <AdvancedSearchPopover
                    onSelect={(comment) => this.props.setActiveNode(comment.nodeId)}
                    data={_.flatMap(this.props.skeletonTracing.trees, (tree) => tree.comments)}
                    searchKey="content"
                    targetId={commentListId}
                  >
                    <ButtonComponent icon={<SearchOutlined />} title="Search through comments" />
                  </AdvancedSearchPopover>
                  <ButtonComponent
                    title="Jump to previous comment"
                    onClick={this.previousComment}
                    icon={<ArrowLeftOutlined />}
                  />
                  <InputComponent
                    value={activeCommentContent}
                    disabled={isEditingDisabled}
                    title={
                      this.props.allowUpdate
                        ? undefined
                        : messages["tracing.read_only_mode_notification"]
                    }
                    onChange={(evt: React.ChangeEvent<HTMLInputElement>) =>
                      this.handleChangeInput(evt, true)
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
                    onClick={() => this.setMarkdownModalVisibility(true)}
                    disabled={isEditingDisabled}
                    title={
                      this.props.allowUpdate
                        ? "Open dialog to edit comment in multi-line mode"
                        : messages["tracing.read_only_mode_notification"]
                    }
                    type={isMultilineComment ? "primary" : "default"}
                    icon={<EditOutlined />}
                  />
                  <ButtonComponent
                    title="Jump to next comment"
                    onClick={() => this.nextComment()}
                    icon={<ArrowRightOutlined />}
                  />
                  <Dropdown menu={this.getSortDropdown()} trigger={["click"]}>
                    <ButtonComponent title="Sort" onClick={this.toggleSortingDirection}>
                      {this.renderSortIcon()}
                    </ButtonComponent>
                  </Dropdown>
                  <ButtonComponent
                    onClick={this.toggleExpandForAllTrees}
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
                  <AutoSizer>
                    {({ height, width }) => (
                      <div
                        style={{
                          height,
                          width,
                        }}
                        className="flex-overflow"
                      >
                        <List
                          id={commentListId}
                          height={height}
                          width={width}
                          rowCount={this.getData().length}
                          rowHeight={24}
                          rowRenderer={this.renderRow}
                          scrollToIndex={scrollIndex > -1 ? scrollIndex : undefined}
                          tabIndex={null}
                          ref={(listEl: List) => {
                            this.listRef = listEl;
                          }}
                        />
                      </div>
                    )}
                  </AutoSizer>
                </div>
              </React.Fragment>
            );
          }}
        </DomVisibilityObserver>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  skeletonTracing: state.tracing.skeleton,
  allowUpdate: state.tracing.restrictions.allowUpdate,
});

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  setActiveNode(nodeId: number) {
    dispatch(setActiveNodeAction(nodeId));
  },

  deleteComment() {
    dispatch(deleteCommentAction());
  },

  createComment(text: string) {
    dispatch(createCommentAction(text));
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(makeSkeletonTracingGuard(CommentTabView));
